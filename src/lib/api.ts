import type { Run, RunEvent, Workflow, WorkflowRequest } from './types';
export class ApiError extends Error { constructor(public status: number, public code: string, message: string) { super(message); } }
export async function apiRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  headers.set('Accept', 'application/json');
  if (options.body !== undefined) headers.set('Content-Type', 'application/json');
  const response = await fetch(path, { cache: 'no-store', credentials: 'same-origin', ...options, headers });
  const body = await response.text();
  let value: unknown;
  try { value = body ? JSON.parse(body) : null; }
  catch { if (response.ok) throw new ApiError(response.status, 'INVALID_RESPONSE', '服务返回了无效数据，请重试'); }
  if (!response.ok) {
    const detail = value && typeof value === 'object' ? value as Record<string, unknown> : {};
    throw new ApiError(response.status, typeof detail.code === 'string' ? detail.code : 'HTTP_ERROR', typeof detail.message === 'string' ? detail.message : `请求失败（HTTP ${response.status}），请重试`);
  }
  return value as T;
}
const id = encodeURIComponent;
export const api = {
  listWorkflows: (signal?: AbortSignal) => apiRequest<Workflow[]>('/api/workflows', { signal }),
  getWorkflow: (workflowId: string, signal?: AbortSignal) => apiRequest<Workflow>(`/api/workflows/${id(workflowId)}`, { signal }),
  listRuns: (workflowId: string, signal?: AbortSignal) => apiRequest<Run[]>(`/api/workflows/${id(workflowId)}/runs`, { signal }),
  getRun: (runId: string, signal?: AbortSignal) => apiRequest<Run>(`/api/runs/${id(runId)}`, { signal }),
  history: (runId: string, after: number, signal?: AbortSignal) => apiRequest<RunEvent[]>(`/api/runs/${id(runId)}/events/history?after=${after}`, { signal }),
  createWorkflow: (definition: WorkflowRequest, signal?: AbortSignal) => apiRequest<Workflow>('/api/workflows', { method: 'POST', body: JSON.stringify(definition), signal }),
  validateWorkflow: (definition: WorkflowRequest, signal?: AbortSignal) => apiRequest<{valid: boolean; order: string[]}>('/api/workflows/validate', { method: 'POST', body: JSON.stringify(definition), signal }),
  createRun: (workflowId: string, inputs: Record<string, string>, key: string, signal?: AbortSignal) => apiRequest<Run>(`/api/workflows/${id(workflowId)}/runs`, { method: 'POST', body: JSON.stringify({inputs}), headers: { 'Idempotency-Key': key }, signal }),
  resumeRun: (runId: string, signal?: AbortSignal) => apiRequest<Run>(`/api/runs/${id(runId)}/resume`, { method: 'POST', signal }),
};
