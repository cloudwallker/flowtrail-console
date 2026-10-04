import type { RunEvent } from '../lib/types';
import { formatTime } from './StatusBadge';
const labels: Record<string, string> = { RUN_QUEUED: '执行排队', RUN_STARTED: '执行开始', RUN_SUCCEEDED: '执行成功', RUN_FAILED: '执行失败', RUN_RESUMED: '恢复执行', RUN_MANUAL_REVIEW: '运行待核查', NODE_STARTED: '节点开始', NODE_SUCCEEDED: '节点成功', NODE_FAILED: '节点失败', NODE_INTERRUPTED: '尝试中断', NODE_RETRY_SCHEDULED: '等待重试', NODE_SKIPPED: '节点跳过', NODE_MANUAL_REVIEW: '节点待核查', LLM_DELTA: '模型片段', MANUAL_REVIEW: '人工核查' };
export function EventRow({ event }: { event: RunEvent }) {
  const text = typeof event.payload.text === 'string' ? event.payload.text : typeof event.payload.error === 'string' ? event.payload.error : typeof event.payload.output === 'string' ? event.payload.output : JSON.stringify(event.payload);
  return <div className="event-row" data-event-row="true" data-event-seq={event.seq} title={`${event.type} · ${text}`}>
    <span className="event-seq">#{event.seq}</span><time className="event-time">{formatTime(event.createdAt)}</time><span className={`event-type ${event.type.includes('FAILED') ? 'danger-text' : ''}`}>{labels[event.type] ?? event.type}</span><span className="event-node">{event.nodeId ?? '运行'}{event.attemptId != null && <small> / {event.attemptId}</small>}</span><span className="event-content">{text === '{}' ? '—' : text}</span>
  </div>;
}
export default EventRow;
