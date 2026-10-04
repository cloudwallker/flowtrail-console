import { describe, expect, it } from 'vitest';
import type { Run } from './lib/types';
import { mergeRunSnapshot } from './queries';

const run = (id: string, seq: number, status: Run['status']): Run => ({ id, workflowId: 'w', status, inputs: {}, nodes: [], startedAt: '2026-10-04T00:00:00Z', finishedAt: null, lastEventSeq: seq });
describe('运行快照水位', () => {
  it('较慢的旧响应不能把成功状态回滚为运行中', () => {
    const current = run('a', 9, 'SUCCEEDED');
    expect(mergeRunSnapshot(current, run('a', 3, 'RUNNING'))).toBe(current);
  });
  it('恢复产生的新水位能够替换旧终态', () => {
    expect(mergeRunSnapshot(run('a', 4, 'FAILED'), run('a', 7, 'RUNNING')).status).toBe('RUNNING');
  });
  it('运行之间不比较水位，新运行不会继承旧运行状态', () => {
    expect(mergeRunSnapshot(run('a', 90, 'SUCCEEDED'), run('b', 1, 'QUEUED')).id).toBe('b');
  });
});
