// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from './lib/api';
import type { Run, Workflow } from './lib/types';
import App from './App';
const workflow: Workflow = { id: 'deep-workflow', name: '深链工作流', createdAt: '2026-10-04T00:00:00Z', nodes: [{ id: 'text', type: 'TEXT', text: '${input.document}' }] };
function mount(path: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[path]}><App /></MemoryRouter></QueryClientProvider>);
}
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
describe('路由深链', () => {
  it('直接打开运行列表并按URL筛选状态', async () => {
    vi.spyOn(api, 'getWorkflow').mockResolvedValue(workflow);
    const run = (id: string, status: Run['status']): Run => ({ id, workflowId: workflow.id, status, inputs: {}, nodes: [], startedAt: workflow.createdAt, finishedAt: workflow.createdAt, lastEventSeq: 1 });
    vi.spyOn(api, 'listRuns').mockResolvedValue([run('success-id', 'SUCCEEDED'), run('failed-id', 'FAILED')]);
    mount('/workflows/deep-workflow/runs?status=SUCCEEDED');
    await screen.findByRole('heading', { name: workflow.name });
    await screen.findByRole('link', { name: 'success-id' });
    expect(screen.queryByRole('link', { name: 'failed-id' })).toBeNull();
    expect((screen.getByRole('combobox', { name: '运行状态筛选' }) as HTMLSelectElement).value).toBe('SUCCEEDED');
    expect(screen.getByText(/最近 50 次运行/)).toBeTruthy();
  });
  it('直接打开新运行表单会建议实际引用的document输入', async () => {
    vi.spyOn(api, 'getWorkflow').mockResolvedValue(workflow);
    mount('/workflows/deep-workflow/new');
    const field = await screen.findByRole('textbox', { name: '输入名称 1' });
    expect((field as HTMLInputElement).value).toBe('document');
  });
  it('未知页面有明确返回路径', async () => {
    mount('/unregistered-page');
    expect(await screen.findByRole('heading', { name: '页面不存在' })).toBeTruthy();
    expect(screen.getByRole('link', { name: '返回工作流' }).getAttribute('href')).toBe('/workflows');
  });
});
