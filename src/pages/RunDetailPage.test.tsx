// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import { api } from '../lib/api';
import type { Run } from '../lib/types';
import RunDetailPage from './RunDetailPage';

vi.mock('../events/useRunStream', () => ({ useRunStream: () => ({ cursor: 0, events: [], attempts: {}, connection: 'complete', retryInMs: 0, error: null, start: vi.fn(), stop: vi.fn() }) }));
const run: Run = { id: 'r', workflowId: 'w', status: 'FAILED', inputs: {}, nodes: [], startedAt: '2026-10-04T00:00:00Z', finishedAt: '2026-10-04T00:00:01Z', lastEventSeq: 0 };
function setup() {
  vi.spyOn(api, 'getRun').mockResolvedValue(run);
  vi.spyOn(api, 'getWorkflow').mockResolvedValue({ id: 'w', name: 'synthetic workflow', nodes: [], createdAt: run.startedAt });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={client}><MemoryRouter initialEntries={['/runs/r']}><Routes><Route path="/runs/:id" element={<RunDetailPage />} /></Routes></MemoryRouter></QueryClientProvider>);
}
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it('aborts the browser resume request when the run page unmounts', async () => {
  let finish: (value: Run) => void = () => {};
  const resume = vi.spyOn(api, 'resumeRun').mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const view = setup();
  fireEvent.click(await screen.findByRole('button', { name: '恢复执行' }));
  await waitFor(() => expect(resume).toHaveBeenCalledTimes(1));
  const signal = resume.mock.calls[0][1];
  view.unmount();
  expect(signal?.aborted).toBe(true);
  await act(async () => finish({ ...run, status: 'QUEUED', lastEventSeq: 1 }));
});

it('supports arrow and end keys with one focusable detail tab', async () => {
  setup();
  const tabs = await screen.findAllByRole('tab');
  tabs[0].focus(); fireEvent.keyDown(tabs[0], { key: 'ArrowRight' });
  await waitFor(() => expect(tabs[1].getAttribute('aria-selected')).toBe('true'));
  expect(document.activeElement).toBe(tabs[1]);
  expect(tabs[0].tabIndex).toBe(-1);
  fireEvent.keyDown(tabs[1], { key: 'End' });
  await waitFor(() => expect(tabs[2].getAttribute('aria-selected')).toBe('true'));
  expect(screen.getByRole('tabpanel').getAttribute('aria-labelledby')).toBe(tabs[2].id);
});
