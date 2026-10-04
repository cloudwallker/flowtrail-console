// @vitest-environment jsdom
import { StrictMode } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { api } from '../lib/api';
import type { Run } from '../lib/types';
import { useRunStream } from './useRunStream';

const sources: TestSource[] = [];
class TestSource {
  closed = false; onopen: (() => void) | null = null; onerror: (() => void) | null = null;
  receive: (event: {data: string}) => void = () => {};
  constructor(public url: string) { sources.push(this); }
  addEventListener(_name: string, fn: (event: {data: string}) => void) { this.receive = fn; }
  close() { this.closed = true; }
}
const snapshot = (id: string): Run => ({ id, workflowId: 'workflow-a', status: 'RUNNING', lastEventSeq: 0, nodes: [], inputs: {}, startedAt: '2026-10-04T12:00:00Z', finishedAt: null });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); sources.length = 0; });
it('StrictMode and route changes leave only the current stream, and unmount closes it', async () => {
  vi.stubGlobal('EventSource', TestSource);
  vi.spyOn(api, 'history').mockResolvedValue([]);
  vi.spyOn(api, 'getRun').mockImplementation(async id => snapshot(id));
  const hook = renderHook(({ id }) => useRunStream(id), { initialProps: { id: 'run-a' }, wrapper: StrictMode });
  await waitFor(() => expect(sources.filter(source => !source.closed)).toHaveLength(1));
  const old = sources.find(source => !source.closed)!;
  hook.rerender({ id: 'run-b' });
  await waitFor(() => expect(sources.find(source => !source.closed)?.url).toContain('run-b'));
  act(() => old.receive({ data: JSON.stringify({runId: 'run-a', seq: 1, nodeId: null, attemptId: null, type: 'RUN_STARTED', payload: {}, createdAt: '2026-10-04T12:00:00Z'}) }));
  expect(hook.result.current.runId).toBe('run-b');
  expect(hook.result.current.cursor).toBe(0);
  expect(old.closed).toBe(true);
  hook.unmount();
  expect(sources.every(source => source.closed)).toBe(true);
});
