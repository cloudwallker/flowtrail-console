import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { EventRow } from './EventRow';
import type { RunEvent } from '../lib/types';
const event = (type: string): RunEvent => ({ runId: 'r', nodeId: 'http', attemptId: 2, seq: 7, type, payload: { reason: 'Lease takeover' }, createdAt: '2026-10-04T00:00:00Z' });
describe('事件行', () => {
  it('保留未知事件类型、独立尝试和原始载荷', () => {
    const html = renderToStaticMarkup(<EventRow event={event('FUTURE_EVENT')} />);
    expect(html).toContain('FUTURE_EVENT');
    expect(html).toContain('Lease takeover');
    expect(html).toContain('data-event-seq="7"');
    expect(html).toContain(' / 2');
  });
  it('将实际的中断与重试事件解释为明确中文', () => {
    expect(renderToStaticMarkup(<EventRow event={event('NODE_INTERRUPTED')} />)).toContain('尝试中断');
    expect(renderToStaticMarkup(<EventRow event={event('NODE_RETRY_SCHEDULED')} />)).toContain('等待重试');
  });
});
