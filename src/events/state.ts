import type { RunEvent } from '../lib/types';
import { z } from 'zod';
export interface StreamAttempt { nodeId: string; attemptId: number; text: string; status: string }
export interface EventState { runId: string; cursor: number; events: RunEvent[]; attempts: Record<string, StreamAttempt> }
export class EventGapError extends Error {
  constructor(public expected: number, public received: number) { super(`事件序号存在缺口：需要 ${expected}，收到 ${received}`); }
}
export class EventProtocolError extends Error {}
const eventSchema = z.object({
  runId: z.string().min(1), nodeId: z.string().nullable(), attemptId: z.number().int().nonnegative().nullable(),
  seq: z.number().int().positive().max(Number.MAX_SAFE_INTEGER), type: z.string().min(1),
  payload: z.record(z.string(), z.unknown()), createdAt: z.iso.datetime({ offset: true }),
});
export function createEventState(runId: string): EventState { return { runId, cursor: 0, events: [], attempts: {} }; }
export function acceptEvent(state: EventState, raw: RunEvent): EventState {
  const event = eventSchema.parse(raw);
  if (event.runId !== state.runId || event.seq <= state.cursor) return state;
  if (event.seq !== state.cursor + 1) throw new EventGapError(state.cursor + 1, event.seq);
  let attempts = state.attempts;
  if (event.type === 'LLM_DELTA' && (typeof event.payload.text !== 'string' || !event.nodeId || event.attemptId === null)) {
    throw new EventProtocolError('模型片段结构无效，已停止推进事件游标');
  }
  if (event.nodeId && event.attemptId !== null) {
    const key = `${event.nodeId}:${event.attemptId}`;
    const previous = attempts[key] || { nodeId: event.nodeId, attemptId: event.attemptId, text: '', status: 'RUNNING' };
    const next = { ...previous };
    if (event.type === 'LLM_DELTA') next.text = (next.text + event.payload.text).slice(0, 262144);
    if (event.type.startsWith('NODE_')) next.status = event.type.slice(5);
    attempts = { ...attempts, [key]: next };
  }
  // Only publish the new contiguous cursor after every validation/projection step succeeded.
  return { ...state, cursor: event.seq, events: [...state.events, event], attempts };
}
