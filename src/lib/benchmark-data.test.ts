import { expect, it } from 'vitest';
import { benchmarkEvents } from './benchmark-data';
it('uses deterministic full history with unique contiguous sequences and stable attempts', () => {
  const data = benchmarkEvents(10000);
  expect(data).toHaveLength(10000);
  expect(data[0].seq).toBe(1);
  expect(data.at(-1)?.seq).toBe(10000);
  expect(new Set(data.map(event => `${event.runId}:${event.seq}`)).size).toBe(10000);
  expect(data).toEqual(benchmarkEvents(10000));
  expect(data.every(event => Number.isFinite(Date.parse(event.createdAt)))).toBe(true);
});
