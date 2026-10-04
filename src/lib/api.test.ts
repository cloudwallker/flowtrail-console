import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, apiRequest, api } from './api';
afterEach(() => vi.unstubAllGlobals());
describe('API contract', () => {
  it('passes cancellation to fetch and uses the requested JSON body', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response('{"id":"run-a"}', { status: 202 }));
    vi.stubGlobal('fetch', fetcher);
    const controller = new AbortController();
    await apiRequest('/api/example', { method: 'POST', body: '{}', signal: controller.signal });
    expect(fetcher.mock.calls[0][1].signal).toBe(controller.signal);
    expect(new Headers(fetcher.mock.calls[0][1].headers).get('Content-Type')).toBe('application/json');
  });
  it('preserves actionable status and error code', async () => {
    vi.stubGlobal('fetch', async () => new Response('{"code":"CONFLICT","message":"Lease is active"}', { status: 409 }));
    await expect(api.getRun('run-a')).rejects.toMatchObject({ status: 409, code: 'CONFLICT', message: 'Lease is active' });
    expect(new ApiError(404, 'NOT_FOUND', 'missing')).toBeInstanceOf(Error);
  });
  it('reuses the supplied idempotency key and encodes identifiers', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response('{"id":"run-a"}', { status: 202 }));
    vi.stubGlobal('fetch', fetcher);
    await api.createRun('workflow /a', { document: '演示' }, 'same-submission');
    expect(fetcher.mock.calls[0][0]).toBe('/api/workflows/workflow%20%2Fa/runs');
    expect(new Headers(fetcher.mock.calls[0][1].headers).get('Idempotency-Key')).toBe('same-submission');
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({ inputs: { document: '演示' } });
  });
  it('passes a page-owned cancellation signal to every mutation request', async () => {
    const fetcher = vi.fn().mockImplementation(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetcher);
    const controller = new AbortController();
    await api.validateWorkflow({ name: 'synthetic', nodes: [] }, controller.signal);
    await api.createWorkflow({ name: 'synthetic', nodes: [] }, controller.signal);
    await api.createRun('w', {}, 'synthetic-key', controller.signal);
    await api.resumeRun('r', controller.signal);
    expect(fetcher.mock.calls).toHaveLength(4);
    for (const call of fetcher.mock.calls) expect(call[1].signal).toBe(controller.signal);
  });
});
