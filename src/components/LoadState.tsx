import { AlertTriangle, FolderOpen, LoaderCircle, RotateCw } from 'lucide-react';
import { ApiError } from '../lib/api';
import { Link } from 'react-router-dom';
export function LoadingState({ title = '正在加载数据' }: { title?: string }) {
  return <div className="state-panel" role="status"><LoaderCircle className="spin" size={30} /><h2>{title}</h2><p>正在从 FlowTrail 获取最新状态。</p></div>;
}
export function ErrorState({ error, retry }: { error: unknown; retry?: () => void }) {
  const notFound = error instanceof ApiError && error.status === 404;
  return <div className="state-panel" role="alert"><AlertTriangle size={30} /><h2>{notFound ? '没有找到这个资源' : '暂时无法加载'}</h2><p>{notFound ? '资源可能不存在，请检查地址或返回工作流列表。' : error instanceof Error ? error.message : '请求失败，请稍后重试。'}</p><div className="button-row">{retry && <button className="button secondary" onClick={retry}><RotateCw size={16} />重新加载</button>}<Link className="button ghost" to="/workflows">返回工作流</Link></div></div>;
}
export function EmptyState({ title, children }: { title: string; children?: React.ReactNode }) {
  return <div className="state-panel empty"><FolderOpen size={32} /><h2>{title}</h2>{children}</div>;
}
export function errorMessage(error: unknown) { return error instanceof Error ? error.message : '请求失败，请稍后重试。'; }
