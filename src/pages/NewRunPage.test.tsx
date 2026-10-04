// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Link, MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from '../lib/api';
import type { Run, Workflow } from '../lib/types';
import { keys } from '../queries';
import NewRunPage from './NewRunPage';
const workflow: Workflow = { id: 'w', name: '文本工作流', createdAt: '2026-10-04T00:00:00Z', nodes: [{ id: 'document', type: 'TEXT', text: '${input.document}' }] };
const run: Run = { id: 'created-run', workflowId: 'w', status: 'QUEUED', inputs: { document: 'changed' }, nodes: [], startedAt: '2026-10-04T00:00:00Z', finishedAt: null, lastEventSeq: 1 };
function setup(client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })) {
  vi.spyOn(api, 'getWorkflow').mockResolvedValue(workflow);
  render(<QueryClientProvider client={client}><MemoryRouter initialEntries={['/workflows/w/new']}><Link to="/elsewhere">离开表单</Link><Routes><Route path="/workflows/:id/new" element={<NewRunPage />} /><Route path="/runs/:id" element={<p>运行创建成功</p>} /><Route path="/elsewhere" element={<p>其他页面</p>} /></Routes></MemoryRouter></QueryClientProvider>);
  return userEvent.setup();
}
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
describe('新运行交互', () => {
  it('后台刷新失败保留已编辑输入，重试获取工作流后继续使用同一表单', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const user = setup(client);
    const input = await screen.findByRole('textbox', { name: '输入值 1' });
    await user.clear(input);
    await user.type(input, '尚未提交的编辑内容');
    vi.mocked(api.getWorkflow).mockRejectedValueOnce(new TypeError('工作流刷新连接中断'));

    await act(async () => { await client.refetchQueries({ queryKey: keys.workflow('w') }); });

    await screen.findByText(/工作流刷新连接中断/);
    expect(screen.queryByRole('textbox', { name: '输入值 1' })).toBe(input);
    expect((input as HTMLTextAreaElement).value).toBe('尚未提交的编辑内容');
    expect((await screen.findByRole('alert')).textContent).toContain('工作流刷新连接中断');
    await user.click(await screen.findByRole('button', { name: '重新加载' }));
    await waitFor(() => expect(screen.queryByText(/工作流刷新连接中断/)).toBeNull());
    expect(screen.getByRole('textbox', { name: '输入值 1' })).toBe(input);
    expect((input as HTMLTextAreaElement).value).toBe('尚未提交的编辑内容');
  });
  it('结果不明后后台刷新失败再恢复，不会丢失同参重试的请求键', async () => {
    const requests: { inputs: Record<string, string>; key: string }[] = [];
    vi.spyOn(api, 'createRun').mockImplementation(async (_workflow, inputs, key) => {
      requests.push({ inputs, key });
      if (requests.length === 1) throw new TypeError('提交响应丢失');
      return run;
    });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    const user = setup(client);
    await screen.findByRole('textbox', { name: '输入值 1' });
    await user.click(screen.getByRole('button', { name: '启动运行' }));
    await screen.findByText('提交未能确认');
    const originalKey = requests[0].key;
    expect(screen.getByText(originalKey)).toBeTruthy();
    vi.mocked(api.getWorkflow).mockRejectedValueOnce(new TypeError('工作流刷新连接中断'));

    await act(async () => { await client.refetchQueries({ queryKey: keys.workflow('w') }); });
    await user.click(await screen.findByRole('button', { name: '重新加载' }));
    await waitFor(() => expect(screen.queryByText(/工作流刷新连接中断/)).toBeNull());
    await user.click(screen.getByRole('button', { name: /^(启动运行|重新提交运行)$/ }));
    await screen.findByText('运行创建成功');

    expect(requests).toHaveLength(2);
    expect(requests[1].inputs).toEqual(requests[0].inputs);
    expect(requests[1].key).toBe(originalKey);
  });
  it('结果不明同参复用请求键，修改输入后使用新键', async () => {
    const requests: { inputs: Record<string, string>; key: string }[] = [];
    vi.spyOn(api, 'createRun').mockImplementation(async (_workflow, inputs, key) => { requests.push({ inputs, key }); if (requests.length < 3) throw new TypeError('网络中断'); return run; });
    const user = setup();
    await screen.findByRole('textbox', { name: '输入值 1' });
    await user.click(screen.getByRole('button', { name: '启动运行' }));
    await screen.findByRole('alert');
    await user.click(screen.getByRole('button', { name: '重新提交运行' }));
    await waitFor(() => expect(requests).toHaveLength(2));
    expect(requests[0].key).toBe(requests[1].key);
    await user.clear(screen.getByRole('textbox', { name: '输入值 1' }));
    await user.type(screen.getByRole('textbox', { name: '输入值 1' }), 'changed');
    await user.click(screen.getByRole('button', { name: '重新提交运行' }));
    await screen.findByText('运行创建成功');
    expect(requests[2].key).not.toBe(requests[1].key);
    expect(requests[2].inputs).toEqual({ document: 'changed' });
  });
  it('删除必需输入后阻止提交并给出原因', async () => {
    const create = vi.spyOn(api, 'createRun');
    const user = setup();
    await screen.findByRole('textbox', { name: '输入值 1' });
    await user.click(screen.getByRole('button', { name: '删除输入 1' }));
    await user.click(screen.getByRole('button', { name: '启动运行' }));
    expect((await screen.findByRole('alert')).textContent).toContain('document');
    expect(create).not.toHaveBeenCalled();
  });
  it('离开页面后的创建响应不会改变当前路由', async () => {
    let resolve: (value: Run) => void = () => undefined;
    vi.spyOn(api, 'createRun').mockImplementation(() => new Promise<Run>((done) => { resolve = done; }));
    const user = setup();
    await screen.findByRole('textbox', { name: '输入值 1' });
    await user.click(screen.getByRole('button', { name: '启动运行' }));
    await screen.findByRole('button', { name: '正在提交…' });
    await user.click(screen.getByRole('link', { name: '离开表单' }));
    resolve(run);
    await waitFor(() => expect(screen.getByText('其他页面')).toBeTruthy());
    expect(screen.queryByText('运行创建成功')).toBeNull();
  });
  it('离开页面会中止待确认提交的浏览器请求', async () => {
    let submittedSignal: AbortSignal | undefined;
    vi.spyOn(api, 'createRun').mockImplementation((_workflow, _inputs, _key, signal) => {
      submittedSignal = signal;
      return new Promise<Run>((_resolve, reject) => {
        signal?.addEventListener('abort', () => reject(new DOMException('请求已中止', 'AbortError')), { once: true });
      });
    });
    const user = setup();
    await screen.findByRole('textbox', { name: '输入值 1' });
    await user.click(screen.getByRole('button', { name: '启动运行' }));
    await screen.findByRole('button', { name: '正在提交…' });
    await user.click(screen.getByRole('link', { name: '离开表单' }));
    await screen.findByText('其他页面');

    expect(submittedSignal?.aborted).toBe(true);
    expect(screen.queryByText('运行创建成功')).toBeNull();
  });
});
