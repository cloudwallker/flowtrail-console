import { afterEach, describe, expect, it, vi } from 'vitest';
import { RunEventClient } from './client';
import type { EventConnection } from './client';
import type { Run, RunEvent } from '../lib/types';

class FakeSource implements EventConnection {
  closed = false; onopen: (() => void) | null = null; onerror: (() => void) | null = null;
  receive: (message: { data: string }) => void = () => {};
  addEventListener(_name: string, listener: (message: { data: string }) => void) { this.receive = listener; }
  close() { this.closed = true; }
  send(event: RunEvent) { this.receive({ data: JSON.stringify(event) }); }
}
const ev = (seq: number, type = 'LLM_DELTA'): RunEvent => ({ runId: 'run-a', nodeId: 'summary', attemptId: 1, seq, type, payload: { text: '片段' }, createdAt: '2026-10-04T12:00:00Z' });
const run = (status: Run['status'] = 'RUNNING', seq = 0): Run => ({ id: 'run-a', workflowId: 'workflow-a', status, lastEventSeq: seq, nodes: [], inputs: {}, startedAt: '2026-10-04T12:00:00Z', finishedAt: null });
function fixture(history: (after: number, signal?: AbortSignal) => Promise<RunEvent[]> = async () => [], snapshot = run()) {
  const sources: FakeSource[] = []; const urls: string[] = []; const cursors: number[] = [];
  const client = new RunEventClient('run-a', {
    history: async (_id, after, signal) => { cursors.push(after); return history(after, signal); },
    run: async () => snapshot,
    source: url => { const source = new FakeSource(); urls.push(url); sources.push(source); return source; },
    random: () => 0.5,
  });
  return { client, sources, urls, cursors };
}
afterEach(() => vi.useRealTimers());
describe('event client lifecycle', () => {
  it('distinguishes completed replay from awaiting the SSE handshake', async () => {
    const f = fixture();
    await f.client.start();
    expect(f.client.getSnapshot().connection).toBe('connecting');
    f.sources[0].onopen?.();
    expect(f.client.getSnapshot().connection).toBe('live');
    f.client.stop();
  });
  it('loads multiple history pages before continuing from the contiguous cursor', async () => {
    const events = Array.from({ length: 1205 }, (_, i) => ev(i + 1));
    const f = fixture(async after => events.filter(event => event.seq > after).slice(0, 1000));
    await f.client.start();
    expect(f.cursors).toEqual([0, 1000]);
    expect(f.client.getSnapshot().events).toHaveLength(1205);
    expect(f.urls[0]).toContain('after=1205');
    f.client.stop();
  });
  it('fills gaps without advancing directly to a larger received sequence', async () => {
    const f = fixture(async after => after === 1 ? [ev(2), ev(3)] : []);
    await f.client.start();
    f.sources[0].send(ev(1)); f.sources[0].send(ev(3));
    await vi.waitFor(() => expect(f.client.getSnapshot().cursor).toBe(3));
    expect(f.client.getSnapshot().events.map(event => event.seq)).toEqual([1, 2, 3]);
    expect(f.sources[0].closed).toBe(true);
    expect(f.urls.at(-1)).toContain('after=3');
    f.client.stop();
  });
  it('owns reconnection and clears it on stop', async () => {
    vi.useFakeTimers();
    const f = fixture(); await f.client.start();
    f.sources[0].onerror?.();
    expect(f.sources[0].closed).toBe(true);
    expect(f.client.getSnapshot().connection).toBe('reconnecting');
    f.client.stop(); await vi.advanceTimersByTimeAsync(60000);
    expect(f.sources).toHaveLength(1);
    expect(f.client.getSnapshot().connection).toBe('paused');
  });
  it('ignores events and in-flight history responses from a stopped generation', async () => {
    let finish: (events: RunEvent[]) => void = () => {};
    const f = fixture(() => new Promise(resolve => { finish = resolve; }));
    const loading = f.client.start(); f.client.stop(); finish([ev(1)]); await loading;
    expect(f.client.getSnapshot().cursor).toBe(0);
    expect(f.sources).toHaveLength(0);
  });
  it('does not stop on a historical terminal event while the latest run is active', async () => {
    const f = fixture(); await f.client.start();
    f.sources[0].send(ev(1, 'RUN_FAILED')); f.sources[0].send(ev(2, 'RUN_QUEUED'));
    expect(f.sources[0].closed).toBe(false);
    expect(f.client.getSnapshot().cursor).toBe(2);
    f.client.stop();
  });
  it('finishes only after a terminal snapshot watermark is fully consumed', async () => {
    const f = fixture(async () => [ev(1), ev(2)], run('SUCCEEDED', 2));
    await f.client.start();
    expect(f.client.getSnapshot().connection).toBe('complete');
    expect(f.sources).toHaveLength(0);
  });
  it('stops on malformed payload without consuming it or silently reconnecting', async () => {
    const f = fixture(); await f.client.start();
    f.sources[0].receive({ data: JSON.stringify({ ...ev(1), payload: { text: 12 } }) });
    expect(f.client.getSnapshot().cursor).toBe(0);
    expect(f.client.getSnapshot().connection).toBe('error');
    expect(f.sources[0].closed).toBe(true);
  });
  it('also stops when a malformed model delta is returned by history', async () => {
    const f = fixture(async () => [{ ...ev(1), payload: { text: 12 } }]);
    await f.client.start();
    expect(f.client.getSnapshot().cursor).toBe(0);
    expect(f.client.getSnapshot().connection).toBe('error');
    expect(f.sources).toHaveLength(0);
  });
  it('ignores callbacks from an earlier connection after a new subscription starts', async () => {
    const f = fixture(); await f.client.start(); const old = f.sources[0];
    f.client.stop(); await f.client.start();
    old.send(ev(1)); old.onerror?.(); old.onopen?.();
    expect(f.client.getSnapshot().cursor).toBe(0);
    expect(f.sources[1].closed).toBe(false);
    f.client.stop();
  });
  it('caps reconnect delay after jitter while the network remains unavailable', async () => {
    vi.useFakeTimers();
    const client = new RunEventClient('run-a', {
      history: async () => { throw new Error('offline'); },
      run: async () => run(),
      source: () => new FakeSource(),
      random: () => 1,
    });
    await client.start();
    for (let retry = 0; retry < 7; retry++) {
      const delay = client.getSnapshot().retryInMs;
      expect(delay).toBeLessThanOrEqual(30000);
      await vi.advanceTimersByTimeAsync(delay);
    }
    client.stop();
  });
});
