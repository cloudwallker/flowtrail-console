import { Link, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, ArrowUpRight, Play, RefreshCw, Search } from 'lucide-react';
import { useRuns, useWorkflow } from '../queries';
import { EmptyState, ErrorState, LoadingState } from '../components/LoadState';
import { formatTime, StatusBadge } from '../components/StatusBadge';
export default function RunsPage() {
  const { id = '' } = useParams();
  const workflow = useWorkflow(id);
  const runs = useRuns(id);
  const [search, setSearch] = useSearchParams();
  const q = search.get('q') ?? '';
  const status = search.get('status') ?? '';
  const update = (key: string, value: string) => { const next = new URLSearchParams(search); if (value) next.set(key, value); else next.delete(key); setSearch(next, { replace: true }); };
  if (workflow.isPending) return <LoadingState />;
  if (workflow.isError) return <ErrorState error={workflow.error} retry={() => void workflow.refetch()} />;
  const items = runs.data ?? [];
  const filtered = items.filter((run) => (!status || run.status === status) && run.id.toLowerCase().includes(q.toLowerCase()));
  return <><Link className="back-link" to="/workflows"><ArrowLeft size={15} />全部工作流</Link><div className="page-heading"><div><div className="eyebrow">RUN HISTORY / 执行历史</div><h1>{workflow.data.name}</h1><p>{workflow.data.nodes.length} 个节点 · <span className="mono">{id}</span></p></div><Link className="button primary" to={`/workflows/${id}/new`}><Play size={17} />新运行</Link></div>
    <div className="notice neutral">仅展示该工作流最近 50 次运行，按创建时间倒序。列表每 5 秒刷新。</div>
    <div className="section-bar"><h2>最近运行 <span className="count">{items.length}</span></h2><div className="filters"><label className="search-field"><Search size={17} /><input aria-label="搜索运行ID" value={q} onChange={(event) => update('q', event.target.value)} placeholder="搜索运行 ID" /></label><select aria-label="运行状态筛选" value={status} onChange={(event) => update('status', event.target.value)}><option value="">全部状态</option><option value="QUEUED">等待执行</option><option value="RUNNING">运行中</option><option value="SUCCEEDED">已成功</option><option value="FAILED">已失败</option><option value="MANUAL_REVIEW">待人工核查</option></select><button className="icon-button" title="刷新运行列表" aria-label="刷新运行列表" disabled={runs.isFetching} onClick={() => void runs.refetch()}><RefreshCw size={17} className={runs.isFetching ? 'spin' : ''} /></button></div></div>
    {runs.isError && runs.data && <div className="notice warning" role="alert">刷新失败，当前显示上次加载的运行历史。</div>}{runs.isPending ? <LoadingState title="正在加载运行历史" /> : runs.isError && !runs.data ? <ErrorState error={runs.error} retry={() => void runs.refetch()} /> : !filtered.length ? <EmptyState title={items.length ? '没有符合条件的运行' : '还没有运行记录'}><p>{items.length ? '尝试调整筛选条件。' : '提交输入，让这条工作流开始执行。'}</p>{!items.length && <Link className="button primary" to={`/workflows/${id}/new`}><Play size={16} />启动第一次运行</Link>}</EmptyState> : <div className="table-card"><table className="runs-table"><thead><tr><th>运行 ID</th><th>状态</th><th>成功节点</th><th>创建时间</th><th><span className="sr-only">查看</span></th></tr></thead><tbody>{filtered.map((run) => <tr key={run.id}><td><Link className="run-link mono" to={`/runs/${run.id}`}>{run.id}</Link></td><td><StatusBadge status={run.status} /></td><td>{run.nodes.filter((node) => node.status === 'SUCCEEDED').length}<span className="muted"> / {run.nodes.length}</span></td><td className="table-time">{formatTime(run.startedAt)}</td><td><Link className="icon-button" aria-label={`查看运行 ${run.id}`} to={`/runs/${run.id}`}><ArrowUpRight size={18} /></Link></td></tr>)}</tbody></table></div>}
  </>;
}
