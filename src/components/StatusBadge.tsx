import type { NodeStatus, RunStatus } from '../lib/types';
const labels: Record<string, string> = { QUEUED: '等待执行', PENDING: '等待执行', RUNNING: '运行中', SUCCEEDED: '已成功', FAILED: '已失败', MANUAL_REVIEW: '待人工核查', SKIPPED: '已跳过', INTERRUPTED: '已中断' };
export function StatusBadge({ status }: { status: RunStatus | NodeStatus | string }) {
  return <span className={`status-badge status-${status.toLowerCase()}`}><span className="status-dot" />{labels[status] ?? status}</span>;
}
export function formatTime(value: string | null | undefined) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
}
export function duration(ms: number) { return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(2)} s`; }
