// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, expect, it, vi } from 'vitest';
import { api } from '../lib/api';
import { CreateWorkflowDialog } from './CreateWorkflowDialog';

vi.mock('./Modal', () => ({ Modal: ({ children }: { children: React.ReactNode }) => <div role="dialog">{children}</div> }));
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it('coalesces concurrent valid form submissions before React renders pending state', async () => {
  let release: () => void = () => {};
  const validate = vi.spyOn(api, 'validateWorkflow').mockImplementation(() => new Promise(resolve => { release = () => resolve({ valid: true, order: [] }); }));
  const create = vi.spyOn(api, 'createWorkflow').mockResolvedValue({ id: 'synthetic', name: '文本处理链', nodes: [], createdAt: '2026-10-04T00:00:00Z' });
  const client = new QueryClient(); const close = vi.fn();
  const view = render(<QueryClientProvider client={client}><CreateWorkflowDialog onClose={close} /></QueryClientProvider>);
  const form = view.container.querySelector('form')!;
  act(() => { fireEvent.submit(form); fireEvent.submit(form); });
  await waitFor(() => expect(validate).toHaveBeenCalled());
  expect(validate).toHaveBeenCalledTimes(1);
  await act(async () => release());
  await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
  expect(close).toHaveBeenCalledTimes(1);
});

it('aborts validation and never starts creation after the dialog unmounts', async () => {
  let release: () => void = () => {};
  const validate = vi.spyOn(api, 'validateWorkflow').mockImplementation(() => new Promise(resolve => { release = () => resolve({ valid: true, order: [] }); }));
  vi.spyOn(api, 'createWorkflow').mockResolvedValue({ id: 'synthetic', name: '文本处理链', nodes: [], createdAt: '2026-10-04T00:00:00Z' });
  const close = vi.fn(); const client = new QueryClient();
  const view = render(<QueryClientProvider client={client}><CreateWorkflowDialog onClose={close} /></QueryClientProvider>);
  fireEvent.submit(view.container.querySelector('form')!);
  await screen.findByRole('button', { name: '校验并创建中…' });
  view.unmount();
  await act(async () => release());
  expect(validate.mock.calls[0][1]?.aborted).toBe(true);
  expect(api.createWorkflow).not.toHaveBeenCalled();
  expect(close).not.toHaveBeenCalled();
});
