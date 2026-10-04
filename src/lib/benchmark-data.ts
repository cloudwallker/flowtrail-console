import type { RunEvent } from './types';
export function benchmarkEvents(count: number): RunEvent[] {
  if (!Number.isSafeInteger(count) || count < 1 || count > 50000) throw new Error('基准数据数量必须在 1–50000 之间');
  const base = Date.parse('2026-10-04T08:00:00Z');
  return Array.from({ length: count }, (_, index) => ({
    runId: 'benchmark-fixture', nodeId: `node_${index % 6 + 1}`, attemptId: 1 + Math.floor(index / 3000),
    seq: index + 1, type: index % 25 === 0 ? 'NODE_SUCCEEDED' : 'LLM_DELTA',
    payload: { text: `固定合成事件 ${index + 1} · 工作流执行记录与模型输出片段` },
    createdAt: new Date(base + index * 10).toISOString(),
  }));
}
