import { describe, expect, it } from 'vitest';
import { acceptEvent, createEventState, EventGapError } from './state';
import type { RunEvent } from '../lib/types';

const event = (seq: number, overrides: Partial<RunEvent> = {}): RunEvent => ({ runId: 'run-a', nodeId: 'summary', attemptId: 1, seq, type: 'LLM_DELTA', payload: { text: '片段' }, createdAt: '2026-10-04T12:00:00Z', ...overrides });

describe('contiguous event projection', () => {
  it('applies each sequence once and ignores another run', () => {
    const initial = createEventState('run-a');
    const first = acceptEvent(initial, event(1));
    expect(first.cursor).toBe(1);
    expect(first.events).toHaveLength(1);
    expect(acceptEvent(first, event(1))).toBe(first);
    expect(acceptEvent(first, event(2, { runId: 'run-b' }))).toBe(first);
    expect(initial.cursor).toBe(0);
  });
  it('does not advance or mutate anything when a gap is received', () => {
    const state = acceptEvent(createEventState('run-a'), event(1));
    expect(() => acceptEvent(state, event(3))).toThrow(EventGapError);
    expect(state.cursor).toBe(1);
    expect(state.events).toHaveLength(1);
  });
  it('separates interrupted and resumed model attempts', () => {
    let state = acceptEvent(createEventState('run-a'), event(1, { payload: { text: '旧答案' } }));
    state = acceptEvent(state, event(2, { type: 'NODE_INTERRUPTED', payload: {} }));
    state = acceptEvent(state, event(3, { attemptId: 2, payload: { text: '新答案' } }));
    expect(state.attempts['summary:1']).toMatchObject({ text: '旧答案', status: 'INTERRUPTED' });
    expect(state.attempts['summary:2']).toMatchObject({ text: '新答案', status: 'RUNNING' });
  });
  it('rejects malformed deltas before committing the cursor', () => {
    const state = createEventState('run-a');
    expect(() => acceptEvent(state, event(1, { payload: { text: 42 } }))).toThrow();
    expect(state.cursor).toBe(0);
    expect(state.events).toHaveLength(0);
  });
  it('keeps unknown event types and historical terminal events in the timeline', () => {
    let state = acceptEvent(createEventState('run-a'), event(1, { nodeId: null, attemptId: null, type: 'RUN_FAILED', payload: {} }));
    state = acceptEvent(state, event(2, { nodeId: null, attemptId: null, type: 'RUN_QUEUED', payload: {} }));
    state = acceptEvent(state, event(3, { type: 'FUTURE_PROTOCOL_EXTENSION', payload: { note: 'visible' } }));
    expect(state.cursor).toBe(3);
    expect(state.events.map(e => e.type)).toEqual(['RUN_FAILED', 'RUN_QUEUED', 'FUTURE_PROTOCOL_EXTENSION']);
  });
  it('preserves more than one history page without dropping early events', () => {
    let state = createEventState('run-a');
    for (let seq = 1; seq <= 1205; seq++) state = acceptEvent(state, event(seq));
    expect(state.events).toHaveLength(1205);
    expect(state.events[0].seq).toBe(1);
    expect(state.cursor).toBe(1205);
  });
  it('validates integer sequence and caps displayed model output', () => {
    expect(() => acceptEvent(createEventState('run-a'), event(1.5))).toThrow();
    const state = acceptEvent(createEventState('run-a'), event(1, { payload: { text: 'x'.repeat(270000) } }));
    expect(state.attempts['summary:1'].text.length).toBe(262144);
  });
});
