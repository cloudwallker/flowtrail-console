import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ArrowRight, Blocks, Clock3, Plus, Search, Workflow as WorkflowIcon } from 'lucide-react';
import { useWorkflows } from '../queries';
import { CreateWorkflowDialog } from '../components/CreateWorkflowDialog';
import { EmptyState, ErrorState, LoadingState } from '../components/LoadState';
import { formatTime } from '../components/StatusBadge';
export default function WorkflowsPage() {
  const query = useWorkflows();
  const [search, setSearch] = useSearchParams();
  const [creating, setCreating] = useState(false);
  const q = search.get('q') ?? '';
  const type = search.get('type') ?? '';
  const workflows = query.data ?? [];
  const filtered = workflows.filter((workflow) => workflow.name.toLowerCase().includes(q.toLowerCase()) && (!type || workflow.nodes.some((node) => node.type === type)));
  const updateFilter = (name: string, value: string) => { const next = new URLSearchParams(search); if (value) next.set(name, value); else next.delete(name); setSearch(next, { replace: true }); };
  return <><div className="page-heading"><div><div className="eyebrow">WORKSPACE / 工作空间</div><h1>工作流</h1><p>从定义到执行，每一步都有迹可循。</p></div><button className="button primary" onClick={() => setCreating(true)}><Plus size={18} />创建工作流</button></div>
    <div className="summary-strip"><div><WorkflowIcon size={21} /><span>已定义工作流</span><strong>{query.data ? workflows.length : '—'}</strong></div><div><Blocks size={21} /><span>节点总数</span><strong>{query.data ? workflows.reduce((sum, workflow) => sum + workflow.nodes.length, 0) : '—'}</strong></div><div className="summary-note"><span className="small-dot" />执行状态由服务端确认</div></div>
    <div className="section-bar"><h2>全部工作流 <span className="count">{filtered.length}</span></h2><div className="filters"><label className="search-field"><Search size={17} /><input aria-label="搜索工作流" placeholder="搜索工作流名称" value={q} onChange={(event) => updateFilter('q', event.target.value)} /></label><select aria-label="节点类型筛选" value={type} onChange={(event) => updateFilter('type', event.target.value)}><option value="">全部节点类型</option><option value="TEXT">TEXT</option><option value="HTTP">HTTP</option><option value="LLM">LLM</option></select></div></div>
    {query.isError && query.data && <div className="notice warning" role="alert">刷新失败，当前显示上次加载的工作流。<button className="button ghost small" onClick={() => void query.refetch()}>重试</button></div>}{query.isPending ? <LoadingState /> : query.isError && !query.data ? <ErrorState error={query.error} retry={() => void query.refetch()} /> : filtered.length === 0 ? <EmptyState title={workflows.length ? '没有符合条件的工作流' : '从第一条工作流开始'}><p>{workflows.length ? '调整搜索或节点类型筛选。' : '创建文本、流式模型或恢复演示模板，观察一次真实执行。'}</p>{!workflows.length && <button className="button primary" onClick={() => setCreating(true)}><Plus size={16} />创建工作流</button>}</EmptyState> : <div className="workflow-grid">{filtered.map((workflow) => <article className="workflow-card" key={workflow.id}><div className="workflow-card-top"><span className="workflow-icon"><WorkflowIcon size={23} /></span><span className="tag">{workflow.nodes.length} 个节点</span></div><h3><Link to={`/workflows/${workflow.id}/runs`}>{workflow.name}</Link></h3><p className="mono workflow-id">{workflow.id}</p><div className="node-type-tags">{[...new Set(workflow.nodes.map((node) => node.type))].map((kind) => <span key={kind}>{kind}</span>)}</div><div className="workflow-created"><Clock3 size={14} />创建于 {formatTime(workflow.createdAt)}</div><div className="workflow-card-actions"><Link className="button ghost" to={`/workflows/${workflow.id}/runs`}>查看运行<ArrowRight size={16} /></Link><Link className="button secondary small" to={`/workflows/${workflow.id}/new`}>新运行</Link></div></article>)}</div>}
    {creating && <CreateWorkflowDialog onClose={() => setCreating(false)} />}</>;
}
