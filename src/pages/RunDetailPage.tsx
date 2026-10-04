import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Activity, ArrowLeft, ArrowRight, CheckCircle2, Circle, Clock3, Copy, FileText, LoaderCircle, Pause, Play, RefreshCw, RotateCcw, Search, ShieldAlert, Timer, Unplug } from 'lucide-react';
import { ApiError, api } from '../lib/api';
import type { Run } from '../lib/types';
import { keys, mergeRunSnapshot, useRun, useWorkflow } from '../queries';
import { useRunStream } from '../events/useRunStream';
import { ErrorState, errorMessage, LoadingState } from '../components/LoadState';
import { duration, formatTime, StatusBadge } from '../components/StatusBadge';
import { EventList } from '../components/EventList';
import { NodeDrawer } from '../components/NodeDrawer';
const connectionLabels = { connecting: '正在连接', live: '实时连接', reconnecting: '连接重试中', 'catching-up': '正在补齐事件', paused: '已停止监听', complete: '已追平终态', error: '监听异常' };
const detailTabs = [['overview', '执行概览'], ['events', '事件时间线'], ['inputs', '输入参数']] as const;
export default function RunDetailPage() {
  const { id = '' } = useParams();
  const query = useRun(id);
  if (query.isPending) return <LoadingState title="正在加载运行详情" />;
  if (query.isError && !query.data) return <ErrorState error={query.error} retry={() => void query.refetch()} />;
  if (!query.data) return <LoadingState />;
  return <><RunMonitor key={id} run={query.data} refresh={() => void query.refetch()} fetching={query.isFetching} refreshError={query.isError ? errorMessage(query.error) : null} /></>;
}
function RunMonitor({ run, refresh, fetching, refreshError }: { run: Run; refresh: () => void; fetching: boolean; refreshError: string | null }) {
  const stream = useRunStream(run.id, run);
  const workflow = useWorkflow(run.workflowId);
  const client = useQueryClient();
  const [search, setSearch] = useSearchParams();
  const [nodeId, setNodeId] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const mounted = useRef(true);
  const resuming = useRef(false);
  const resumeController = useRef<AbortController | null>(null);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; resumeController.current?.abort(); }; }, []);
  const requestedTab = search.get('tab') ?? 'overview';
  const tab = detailTabs.some(([value]) => value === requestedTab) ? requestedTab : 'overview';
  const eventQuery = search.get('q') ?? '';
  const eventType = search.get('event') ?? '';
  const update = (key: string, value: string) => { const next = new URLSearchParams(search); if (value) next.set(key, value); else next.delete(key); setSearch(next, { replace: key !== 'tab' }); };
  const resume = useMutation({ mutationFn: () => { if (!mounted.current) throw new DOMException('Page closed', 'AbortError'); resumeController.current = new AbortController(); return api.resumeRun(run.id, resumeController.current.signal); }, onSuccess: (next) => { client.setQueryData(keys.run(run.id), (previous: Run | undefined) => mergeRunSnapshot(previous, next)); void client.invalidateQueries({ queryKey: keys.runs(run.workflowId) }); if (mounted.current) { stream.start(); refresh(); } }, onSettled: () => { resuming.current = false; resumeController.current = null; } });
  const events = useMemo(() => stream.events.filter((event) => (!eventType || event.type === eventType) && (!eventQuery || `${event.seq} ${event.nodeId ?? ''} ${JSON.stringify(event.payload)}`.toLowerCase().includes(eventQuery.toLowerCase()))), [stream.events, eventQuery, eventType]);
  const types = [...new Set(stream.events.map((event) => event.type))].sort();
  const selectedNode = run.nodes.find((node) => node.id === nodeId);
  const succeeded = run.nodes.filter((node) => node.status === 'SUCCEEDED').length;
  const elapsed = run.finishedAt ? new Date(run.finishedAt).getTime() - new Date(run.startedAt).getTime() : null;
  const canResume = run.status === 'FAILED' || run.status === 'MANUAL_REVIEW';
  return <><Link className="back-link" to={`/workflows/${run.workflowId}/runs`}><ArrowLeft size={15} />返回运行历史</Link><div className="page-heading detail-heading"><div><div className="eyebrow">RUN MONITOR / 运行监控</div><h1>{workflow.data?.name ?? '工作流运行'}<StatusBadge status={run.status} /></h1><p className="run-id"><span className="mono">{run.id}</span><button className="icon-button" aria-label="复制运行ID" title={copied ? '已复制' : '复制运行ID'} onClick={() => { void navigator.clipboard?.writeText(run.id).then(() => setCopied(true)).catch(() => setCopied(false)); }}><Copy size={14} /></button>{copied && <span className="small-muted" role="status">已复制</span>}</p></div><div className="button-row"><button className="button secondary" disabled={fetching} onClick={refresh}><RefreshCw size={16} className={fetching ? 'spin' : ''} />刷新状态</button>{canResume && <button className="button primary" disabled={resume.isPending} onClick={() => { if (!resuming.current) { resuming.current = true; resume.mutate(); } }}>{resume.isPending ? <LoaderCircle size={16} className="spin" /> : <RotateCcw size={16} />}{resume.isPending ? '恢复请求中…' : '恢复执行'}</button>}</div></div>
    {refreshError && <div className="notice warning" role="alert">状态刷新失败，保留上次确认的快照：{refreshError}</div>}
    {resume.isError && <div className="notice error" role="alert">{resume.error instanceof ApiError && resume.error.status === 409 ? '当前执行租约仍有效，无法并发恢复。请等待租约释放后重试。' : errorMessage(resume.error)}{run.status === 'MANUAL_REVIEW' && <small>恢复不会绕过下游核查。需要确认原外部操作的结果。</small>}</div>}
    {run.status === 'MANUAL_REVIEW' && <div className="notice warning"><ShieldAlert size={18} /><span>运行需要人工核查外部操作；重新恢复仍会先核查原幂等键。</span></div>}
    <div className="run-metrics"><div><CheckCircle2 size={19} /><span>成功节点</span><strong>{succeeded}<small> / {run.nodes.length}</small></strong></div><div><Clock3 size={19} /><span>创建时间</span><strong className="metric-time">{formatTime(run.startedAt)}</strong></div><div><Timer size={19} /><span>运行总耗时</span><strong>{elapsed == null ? '执行中' : duration(Math.max(0, elapsed))}</strong></div><div><Activity size={19} /><span>已连续消费事件</span><strong>{stream.cursor}<small> 条</small></strong></div></div>
    <div className={`connection-bar connection-${stream.connection}`} role="status"><span className="connection-light" /><strong>{connectionLabels[stream.connection]}</strong><span>{stream.connection === 'reconnecting' ? `约 ${Math.ceil(stream.retryInMs / 1000)} 秒后重试` : stream.connection === 'paused' ? '只停止浏览器监听，后端执行继续' : '连接状态与业务执行状态分别显示'}</span><button className="button ghost small" onClick={stream.connection === 'paused' || stream.connection === 'error' || stream.connection === 'complete' ? stream.start : stream.stop}>{stream.connection === 'paused' || stream.connection === 'error' || stream.connection === 'complete' ? <Play size={14} /> : <Pause size={14} />}{stream.connection === 'paused' || stream.connection === 'error' || stream.connection === 'complete' ? '继续监听' : '停止监听'}</button></div>
    {stream.error && <div className="notice error" role="alert"><Unplug size={17} /><span>{stream.error}</span></div>}
    <div className="tabs" role="tablist" aria-label="运行详情标签">{detailTabs.map(([value, label], index) => <button key={value} id={`detail-tab-${value}`} role="tab" aria-controls="detail-panel" tabIndex={tab === value ? 0 : -1} aria-selected={tab === value} className={tab === value ? 'active' : ''} onClick={() => update('tab', value)} onKeyDown={event => { if (event.altKey || event.ctrlKey || event.metaKey) return; const next = event.key === 'ArrowRight' ? (index + 1) % detailTabs.length : event.key === 'ArrowLeft' ? (index + detailTabs.length - 1) % detailTabs.length : event.key === 'Home' ? 0 : event.key === 'End' ? detailTabs.length - 1 : null; if (next === null) return; event.preventDefault(); update('tab', detailTabs[next][0]); event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus(); }}>{label}{value === 'events' && <span className="count">{stream.events.length}</span>}</button>)}</div>
    <div role="tabpanel" id="detail-panel" aria-labelledby={`detail-tab-${tab}`}>
    {(tab === 'overview' || !['events', 'inputs'].includes(tab)) && <section className="panel"><div className="panel-heading"><div><h2>节点执行</h2><p>选择节点查看输出、错误与每次尝试。</p></div><span className="tag">{run.nodes.length} 个节点</span></div><div className="node-list">{run.nodes.map((node, index) => { const definition = workflow.data?.nodes.find((item) => item.id === node.id); const attempt = Object.values(stream.attempts).find((item) => item.nodeId === node.id && Number(item.attemptId) === node.attemptId); return <button key={node.id} className={`node-row node-${node.status.toLowerCase()}`} onClick={() => setNodeId(node.id)}><span className="node-order">{node.status === 'SUCCEEDED' ? <CheckCircle2 size={23} /> : node.status === 'RUNNING' ? <LoaderCircle size={23} className="spin" /> : <Circle size={23} />}<small>{String(index + 1).padStart(2, '0')}</small></span><div className="node-main"><strong>{node.id}<span className="node-kind">{definition?.type ?? '节点'}</span></strong><span>{node.error || (node.status === 'RUNNING' ? attempt?.text || '等待节点输出…' : node.output || (node.status === 'PENDING' ? '等待依赖节点完成' : '暂无输出'))}</span></div><div className="node-status"><StatusBadge status={node.status} /><small>尝试 #{node.attemptId || '—'} · 最近完成 {node.attempts.some(attempt => attempt.finishedAt !== null) ? duration(node.durationMs) : '—'}</small></div><ArrowRight size={17} className="muted" /></button>; })}</div></section>}
    {tab === 'inputs' && <section className="panel"><div className="panel-heading"><div><h2>本次运行输入</h2><p>这是服务端保存的原始字符串参数。</p></div><FileText size={21} /></div><div className="saved-inputs">{Object.entries(run.inputs).length === 0 ? <p className="muted">本次运行没有输入参数。</p> : Object.entries(run.inputs).map(([key, value]) => <div key={key}><code>{key}</code><pre>{value}</pre></div>)}</div></section>}
    {tab !== 'inputs' && <section className="panel event-panel"><div className="panel-heading"><div><h2>事件时间线 <span className="count">{events.length}</span></h2><p>按连续序号补齐与去重，未知事件类型也会保留。</p></div><span className="tag mono">cursor #{stream.cursor}</span></div><div className="event-toolbar"><label className="search-field"><Search size={16} /><input aria-label="搜索事件" value={eventQuery} onChange={(event) => update('q', event.target.value)} placeholder="搜索节点、序号或事件内容" /></label><select aria-label="事件类型筛选" value={eventType} onChange={(event) => update('event', event.target.value)}><option value="">全部事件类型</option>{types.map((type) => <option key={type} value={type}>{type}</option>)}</select></div><div className="event-table-heading"><span>序号</span><span>时间</span><span>事件</span><span>节点 / 尝试</span><span>内容</span></div><EventList events={events} /><div className="event-footer"><span>当前显示 {events.length} / {stream.events.length} 条事件</span><span>历史事件已按序号归并</span></div></section>}
    </div>
    {selectedNode && <NodeDrawer node={selectedNode} definition={workflow.data?.nodes.find((item) => item.id === selectedNode.id)} attempts={Object.values(stream.attempts).filter((attempt) => attempt.nodeId === selectedNode.id)} onClose={() => setNodeId(null)} />}
  </>;
}
