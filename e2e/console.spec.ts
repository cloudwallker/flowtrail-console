import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import type { APIRequestContext, Page } from '@playwright/test';
import type { NodeDefinition, Run, RunEvent, Workflow } from '../src/lib/types';

const backend = 'http://127.0.0.1:18081';
const control = 'http://127.0.0.1:18083';
const textNodes: NodeDefinition[] = [
  { id: 'checkpoint', type: 'TEXT', text: 'saved:${input.document}' },
  { id: 'result', type: 'TEXT', dependsOn: ['checkpoint'], text: 'done:${checkpoint.output}' },
];
const gateNodes = (key: string): NodeDefinition[] => [
  textNodes[0],
  { id: 'slow_http', type: 'HTTP', dependsOn: ['checkpoint'], method: 'GET', url: `http://127.0.0.1:18082/gate?key=${key}`, timeoutMs: 30000 },
  { id: 'result', type: 'TEXT', dependsOn: ['slow_http'], text: '${checkpoint.output}:${slow_http.output}' },
];
async function workflow(request: APIRequestContext, name: string, nodes = textNodes): Promise<Workflow> {
  const response = await request.post(`${backend}/api/workflows`, { data: { name, nodes } });
  expect(response.status()).toBe(201);
  return response.json();
}
async function startRun(request: APIRequestContext, definition: Workflow, document = 'synthetic acceptance input'): Promise<Run> {
  const response = await request.post(`${backend}/api/workflows/${definition.id}/runs`, { data: { inputs: { document } }, headers: { 'Idempotency-Key': randomUUID() } });
  expect(response.status()).toBe(202);
  return response.json();
}
async function getRun(request: APIRequestContext, id: string): Promise<Run> {
  const response = await request.get(`${backend}/api/runs/${id}`);
  expect(response.status()).toBe(200);
  return response.json();
}
async function awaitRun(request: APIRequestContext, id: string, predicate: (run: Run) => boolean, timeout = 30000): Promise<Run> {
  await expect.poll(async () => predicate(await getRun(request, id)), { timeout, intervals: [100, 250, 500] }).toBe(true);
  return getRun(request, id);
}
async function history(request: APIRequestContext, id: string): Promise<RunEvent[]> {
  const events: RunEvent[] = [];
  for (;;) {
    const response = await request.get(`${backend}/api/runs/${id}/events/history?after=${events.at(-1)?.seq ?? 0}`);
    expect(response.status()).toBe(200);
    const page = await response.json() as RunEvent[];
    events.push(...page);
    if (page.length < 1000) return events;
  }
}
async function caughtUp(page: Page, run: Run) {
  await expect(page.locator('.event-footer')).toContainText(`当前显示 ${run.lastEventSeq} / ${run.lastEventSeq} 条事件`);
  await expect(page.locator('.event-panel .tag')).toHaveText(`cursor #${run.lastEventSeq}`);
}
async function release(request: APIRequestContext, key: string) {
  await expect.poll(async () => {
    const demo = await (await request.get(`${control}/demo/status`)).json();
    return demo.gates[key] || 0;
  }).toBeGreaterThan(0);
  expect((await request.post(`${control}/demo/release`, { data: { key } })).status()).toBe(200);
}

test('workflow creation, URL filters and browser navigation use the real API', async ({ page }) => {
  await page.goto('/workflows');
  await page.getByRole('button', { name: '创建工作流', exact: true }).first().click();
  const dialog = page.getByRole('dialog', { name: '创建工作流' });
  const name = `UI workflow ${randomUUID().slice(0, 8)}`;
  await dialog.getByLabel('工作流名称').fill(name);
  await dialog.getByRole('button', { name: '创建工作流', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await page.getByRole('textbox', { name: '搜索工作流' }).fill(name);
  await expect(page).toHaveURL(new RegExp(`q=${encodeURIComponent(name).replaceAll('%20', '\\+')}`));
  await page.getByRole('link', { name, exact: true }).click();
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: '还没有运行记录' })).toBeVisible();
  await expect(page.getByText('仅展示该工作流最近 50 次运行', { exact: false })).toBeVisible();
  await page.goBack();
  await expect(page.getByRole('textbox', { name: '搜索工作流' })).toHaveValue(name);
});

test('deep links and absent routes distinguish missing pages from missing resources', async ({ page, request }) => {
  const definition = await workflow(request, 'deep-link workflow');
  await page.goto(`/workflows/${definition.id}/new`);
  await expect(page.getByRole('heading', { name: '让工作流开始执行' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('textbox', { name: '输入值 1' })).toBeVisible();
  await page.goto('/runs/nonexistent-run');
  await expect(page.getByRole('heading', { name: '没有找到这个资源' })).toBeVisible();
  await page.goto('/unknown-route');
  await expect(page.getByRole('heading', { name: '页面不存在' })).toBeVisible();
});

test('a rapid double click creates one durable run and opens node attempt output', async ({ page, request }) => {
  const definition = await workflow(request, 'double-submit workflow');
  let posts = 0;
  await page.route(`**/api/workflows/${definition.id}/runs`, async route => {
    if (route.request().method() !== 'POST') return route.continue();
    posts += 1;
    const response = await route.fetch();
    await new Promise(resolve => setTimeout(resolve, 300));
    await route.fulfill({ response });
  });
  await page.goto(`/workflows/${definition.id}/new`);
  await page.getByRole('textbox', { name: '输入值 1' }).fill('double click document');
  await page.getByRole('button', { name: '启动运行', exact: true }).dblclick();
  await expect(page).toHaveURL(/\/runs\/[a-f0-9-]+$/);
  expect(posts).toBe(1);
  const runs = await (await request.get(`${backend}/api/workflows/${definition.id}/runs`)).json() as Run[];
  expect(runs).toHaveLength(1);
  const completed = await awaitRun(request, runs[0].id, run => run.status === 'SUCCEEDED');
  await caughtUp(page, completed);
  await page.getByRole('button', { name: /checkpoint/ }).click();
  const drawer = page.getByRole('dialog', { name: '节点 · checkpoint' });
  await expect(drawer.getByText('saved:double click document', { exact: true }).first()).toBeVisible();
  await expect(drawer.getByText('尝试 #1', { exact: true })).toBeVisible();
});

test('an unconfirmed response retries the same inputs with the same idempotency key', async ({ page, request }) => {
  const definition = await workflow(request, 'lost-response workflow');
  const keys: string[] = [];
  await page.route(`**/api/workflows/${definition.id}/runs`, async route => {
    if (route.request().method() !== 'POST') return route.continue();
    keys.push(route.request().headers()['idempotency-key']);
    const response = await route.fetch();
    if (keys.length === 1) return route.abort('failed');
    return route.fulfill({ response });
  });
  await page.goto(`/workflows/${definition.id}/new`);
  await page.getByRole('button', { name: '启动运行', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('提交未能确认');
  await page.getByRole('button', { name: '重新提交运行', exact: true }).click();
  await expect(page).toHaveURL(/\/runs\/[a-f0-9-]+$/);
  expect(keys).toHaveLength(2);
  expect(keys[0]).toBeTruthy();
  expect(keys[1]).toBe(keys[0]);
  expect(await (await request.get(`${backend}/api/workflows/${definition.id}/runs`)).json()).toHaveLength(1);
});

test('editing an unconfirmed submission creates a new key and a distinct run', async ({ page, request }) => {
  const definition = await workflow(request, 'edited-unconfirmed workflow');
  const keys: string[] = [];
  await page.route(`**/api/workflows/${definition.id}/runs`, async route => {
    if (route.request().method() !== 'POST') return route.continue();
    keys.push(route.request().headers()['idempotency-key']);
    const response = await route.fetch();
    if (keys.length === 1) return route.abort('failed');
    return route.fulfill({ response });
  });
  await page.goto(`/workflows/${definition.id}/new`);
  await page.getByRole('button', { name: '启动运行', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('提交未能确认');
  await page.getByRole('textbox', { name: '输入值 1' }).fill('edited synthetic document');
  await page.getByRole('button', { name: '重新提交运行', exact: true }).click();
  await expect(page).toHaveURL(/\/runs\/[a-f0-9-]+$/);
  expect(keys).toHaveLength(2);
  expect(keys[1]).not.toBe(keys[0]);
  const runs = await (await request.get(`${backend}/api/workflows/${definition.id}/runs`)).json() as Run[];
  expect(runs).toHaveLength(2);
  expect(runs.some(run => run.inputs.document === 'edited synthetic document')).toBe(true);
});

test('duplicate input names prevent a request and form navigation cancels the form', async ({ page, request }) => {
  const definition = await workflow(request, 'invalid-form workflow');
  await page.goto(`/workflows/${definition.id}/new`);
  await page.getByRole('button', { name: '添加输入字段' }).click();
  await page.getByRole('textbox', { name: '输入名称 2' }).fill('document');
  await page.getByRole('button', { name: '启动运行', exact: true }).click();
  await expect(page.getByText('输入名称重复')).toBeVisible();
  expect(await (await request.get(`${backend}/api/workflows/${definition.id}/runs`)).json()).toHaveLength(0);
  await page.getByRole('link', { name: '返回', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/workflows/${definition.id}/runs$`));
});

test('loading, a server error and explicit retry are separate visible states', async ({ page, request }) => {
  const definition = await workflow(request, 'error-and-retry workflow');
  let failing = true;
  await page.route(`**/api/workflows/${definition.id}`, async route => {
    if (!failing) return route.continue();
    await new Promise(resolve => setTimeout(resolve, 300));
    return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ code: 'TEST_UNAVAILABLE', message: 'temporary acceptance outage' }) });
  });
  await page.goto(`/workflows/${definition.id}/new`);
  await expect(page.getByRole('status').getByText('正在加载数据')).toBeVisible();
  await expect(page.getByRole('heading', { name: '暂时无法加载' })).toBeVisible();
  failing = false;
  await page.getByRole('button', { name: '重新加载' }).click();
  await expect(page.getByRole('heading', { name: '让工作流开始执行' })).toBeVisible();
});

test('a delayed run A response cannot overwrite navigation to run B', async ({ page, request }) => {
  const a = await workflow(request, `route A ${randomUUID().slice(0, 6)}`);
  const b = await workflow(request, `route B ${randomUUID().slice(0, 6)}`);
  const runA = await startRun(request, a, 'A input');
  const runB = await startRun(request, b, 'B input');
  let entered = false;
  await page.route(`**/api/runs/${runA.id}`, async route => {
    entered = true;
    const response = await route.fetch();
    await new Promise(resolve => setTimeout(resolve, 1600));
    await route.fulfill({ response }).catch(() => {});
  });
  await page.goto(`/runs/${runA.id}`);
  await expect.poll(() => entered).toBe(true);
  await page.getByRole('navigation', { name: '主要导航' }).getByRole('link', { name: '工作流', exact: true }).click();
  await page.getByRole('link', { name: b.name, exact: true }).click();
  await page.getByRole('link', { name: runB.id, exact: true }).click();
  await expect(page.getByRole('heading', { name: new RegExp(b.name) })).toBeVisible();
  await page.waitForTimeout(1800);
  await expect(page).toHaveURL(new RegExp(`/runs/${runB.id}$`));
  await expect(page.locator('.run-id')).toContainText(runB.id);
  await expect(page.locator('.run-id')).not.toContainText(runA.id);
});

test('duplicate and out-of-order SSE frames are repaired from real persisted history', async ({ page, request }) => {
  const key = randomUUID();
  const definition = await workflow(request, 'SSE gap workflow', gateNodes(key));
  const run = await startRun(request, definition);
  await awaitRun(request, run.id, value => value.nodes.some(node => node.id === 'slow_http' && node.status === 'RUNNING'));
  let injected = false;
  await page.route(`**/api/runs/${run.id}/events?*`, async route => {
    if (injected) return route.continue();
    injected = true;
    const cursor = Number(new URL(route.request().url()).searchParams.get('after'));
    await release(request, key);
    await awaitRun(request, run.id, value => value.status === 'SUCCEEDED');
    const events = await history(request, run.id);
    const duplicate = events.find(event => event.seq === cursor)!;
    const gap = events.at(-1)!;
    expect(gap.seq).toBeGreaterThan(cursor + 1);
    const frames = [duplicate, duplicate, gap].map(event => `id: ${event.seq}\nevent: workflow\ndata: ${JSON.stringify(event)}\n\n`).join('');
    await route.fulfill({ status: 200, contentType: 'text/event-stream', body: frames });
  });
  await page.goto(`/runs/${run.id}`);
  const completed = await awaitRun(request, run.id, value => value.status === 'SUCCEEDED');
  await caughtUp(page, completed);
  expect(injected).toBe(true);
  await expect(page.locator('.connection-bar')).toContainText('已追平终态');
  expect(new Set(await page.locator('[data-event-seq]').evaluateAll(rows => rows.map(row => row.getAttribute('data-event-seq')))).size).toBe(await page.locator('[data-event-seq]').count());
});

test('a malformed live event stops consumption at the last valid cursor', async ({ page, request }) => {
  const key = randomUUID();
  const definition = await workflow(request, 'malformed-SSE workflow', gateNodes(key));
  const run = await startRun(request, definition);
  await awaitRun(request, run.id, value => value.nodes.some(node => node.id === 'slow_http' && node.status === 'RUNNING'));
  let validCursor = -1;
  let injected = false;
  await page.route(`**/api/runs/${run.id}/events?*`, async route => {
    if (injected) return route.continue();
    injected = true;
    validCursor = Number(new URL(route.request().url()).searchParams.get('after'));
    const invalid = { runId: run.id, nodeId: 'slow_http', attemptId: 1, seq: validCursor + 1, type: 'LLM_DELTA', payload: { text: 12 }, createdAt: new Date().toISOString() };
    await route.fulfill({ status: 200, contentType: 'text/event-stream', body: `event: workflow\ndata: ${JSON.stringify(invalid)}\n\n` });
  });
  await page.goto(`/runs/${run.id}`);
  await expect(page.locator('.connection-bar')).toContainText('监听异常');
  await expect(page.locator('.event-panel .tag')).toHaveText(`cursor #${validCursor}`);
  await expect(page.getByRole('alert')).toContainText('事件数据无效');
  await release(request, key);
  const completed = await awaitRun(request, run.id, value => value.status === 'SUCCEEDED');
  await page.getByRole('button', { name: '继续监听', exact: true }).click();
  await caughtUp(page, completed);
});

test('offline monitoring does not cancel execution and reconnect fills the entire history', async ({ page, context, request }) => {
  const key = randomUUID();
  const definition = await workflow(request, 'offline workflow', gateNodes(key));
  const run = await startRun(request, definition);
  await page.goto(`/runs/${run.id}`);
  await expect(page.locator('.connection-bar')).toContainText('实时连接');
  await context.setOffline(true);
  await release(request, key);
  const completed = await awaitRun(request, run.id, value => value.status === 'SUCCEEDED');
  await expect(page.getByRole('heading', { level: 1 })).not.toContainText('已失败');
  await context.setOffline(false);
  await caughtUp(page, completed);
  const events = await history(request, run.id);
  expect(events.map(event => event.seq)).toEqual(Array.from({ length: completed.lastEventSeq }, (_, index) => index + 1));
});

test('pausing and leaving a run close its EventSource while the backend continues', async ({ page, request }) => {
  await page.addInitScript(() => {
    const NativeSource = window.EventSource;
    const tracker = { active: 0, opened: 0 };
    Object.assign(window, { __flowtrailSources: tracker });
    window.EventSource = class extends NativeSource {
      private counted = true;
      constructor(url: string | URL, options?: EventSourceInit) { super(url, options); tracker.active += 1; tracker.opened += 1; }
      override close() { if (this.counted) { tracker.active -= 1; this.counted = false; } super.close(); }
    };
  });
  const key = randomUUID();
  const definition = await workflow(request, 'subscription cleanup workflow', gateNodes(key));
  const run = await startRun(request, definition);
  await page.goto(`/runs/${run.id}`);
  await expect(page.locator('.connection-bar')).toContainText('实时连接');
  await page.getByRole('button', { name: '停止监听', exact: true }).click();
  await expect(page.locator('.connection-bar')).toContainText('已停止监听');
  await expect.poll(() => page.evaluate(() => (window as Window & { __flowtrailSources: { active: number } }).__flowtrailSources.active)).toBe(0);
  expect((await getRun(request, run.id)).status).toBe('RUNNING');
  await page.getByRole('button', { name: '继续监听', exact: true }).click();
  await expect(page.locator('.connection-bar')).toContainText('实时连接');
  await page.getByRole('navigation', { name: '主要导航' }).getByRole('link', { name: '工作流', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as Window & { __flowtrailSources: { active: number } }).__flowtrailSources.active)).toBe(0);
  const opened = await page.evaluate(() => (window as Window & { __flowtrailSources: { opened: number } }).__flowtrailSources.opened);
  await page.waitForTimeout(1400);
  expect(await page.evaluate(() => (window as Window & { __flowtrailSources: { opened: number } }).__flowtrailSources.opened)).toBe(opened);
  await release(request, key);
  await awaitRun(request, run.id, value => value.status === 'SUCCEEDED');
});

test('a real Java process crash reuses committed checkpoints and isolates the new attempt', async ({ page, request }, testInfo) => {
  const key = randomUUID();
  const definition = await workflow(request, 'real process recovery workflow', gateNodes(key));
  const run = await startRun(request, definition, 'crash recovery synthetic document');
  const before = await awaitRun(request, run.id, value => value.nodes.some(node => node.id === 'checkpoint' && node.status === 'SUCCEEDED') && value.nodes.some(node => node.id === 'slow_http' && node.status === 'RUNNING'));
  await page.goto(`/runs/${run.id}`);
  await expect(page.locator('.connection-bar')).toContainText('实时连接');
  const oldHealth = await (await request.get(`${control}/health`)).json();
  let restoreBackend = false;
  try {
    const crash = await request.post(`${control}/crash`);
    restoreBackend = crash.status() === 200;
    expect(crash.status()).toBe(200);
    expect((await crash.json()).crashedPid).toBe(oldHealth.backendPid);
    await expect(page.locator('.connection-bar')).toContainText('连接重试中');
    const restart = await request.post(`${control}/restart`, { timeout: 60000 });
    expect(restart.status()).toBe(200);
    restoreBackend = false;
    const newProcess = await restart.json();
    expect(newProcess.backendPid).not.toBe(oldHealth.backendPid);
    expect(newProcess.sameIsolatedDatabase).toBe(true);
    await awaitRun(request, run.id, value => value.nodes.some(node => node.id === 'slow_http' && node.attemptId === 2 && node.status === 'RUNNING'));
    await release(request, key);
    const after = await awaitRun(request, run.id, value => value.status === 'SUCCEEDED');
    const checkpoint = after.nodes.find(node => node.id === 'checkpoint')!;
    const interrupted = after.nodes.find(node => node.id === 'slow_http')!;
    expect(checkpoint.attemptId).toBe(1);
    expect(checkpoint.attempts).toHaveLength(1);
    expect(interrupted.attempts.map(attempt => [attempt.attemptId, attempt.status])).toEqual([[1, 'INTERRUPTED'], [2, 'SUCCEEDED']]);
    const events = await history(request, run.id);
    expect(events.map(event => event.seq)).toEqual(Array.from({ length: after.lastEventSeq }, (_, index) => index + 1));
    expect(events.filter(event => event.nodeId === 'checkpoint' && event.type === 'NODE_STARTED')).toHaveLength(1);
    expect(events.some(event => event.nodeId === 'slow_http' && event.type === 'NODE_INTERRUPTED' && event.attemptId === 1)).toBe(true);
    expect(events.some(event => event.nodeId === 'slow_http' && event.type === 'NODE_STARTED' && event.attemptId === 2)).toBe(true);
    await caughtUp(page, after);
    await page.getByRole('button', { name: /slow_http/ }).click();
    const drawer = page.getByRole('dialog', { name: '节点 · slow_http' });
    await expect(drawer.getByText('尝试 #2', { exact: true })).toBeVisible();
    await expect(drawer.getByText('尝试 #1', { exact: true })).toBeVisible();
    await expect(drawer.getByText('已中断', { exact: true })).toBeVisible();
    const evidencePath = testInfo.outputPath('recovery-evidence.json');
    await writeFile(evidencePath, JSON.stringify({ oldPid: oldHealth.backendPid, newPid: newProcess.backendPid, sameIsolatedDatabase: true, before, after, events }, null, 2));
    await testInfo.attach('real-process-recovery', { path: evidencePath, contentType: 'application/json' });
  } finally {
    // A failed browser assertion must not leave the owned Java process down
    // and turn unrelated later tests into connection-refused failures.
    if (restoreBackend) {
      const restored = await request.post(`${control}/restart`, { timeout: 60000 });
      expect(restored.status(), 'restore the isolated backend after a failed recovery assertion').toBe(200);
      await release(request, key);
    }
  }
});

test('a stale FAILED snapshot cannot bypass a live server lease or duplicate resume requests', async ({ page, request }) => {
  const key = randomUUID();
  const definition = await workflow(request, 'active lease workflow', gateNodes(key));
  const run = await startRun(request, definition);
  await awaitRun(request, run.id, value => value.status === 'RUNNING');
  await page.goto(`/runs/${run.id}`);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('运行中');
  await expect(page.getByRole('button', { name: '恢复执行', exact: true })).toHaveCount(0);
  // Only the browser GET response is made stale. The real Java service and its
  // live lease remain unchanged, so POST /resume must still enforce HTTP 409.
  let stale = true;
  await page.route(`**/api/runs/${run.id}`, async route => {
    if (!stale) return route.continue();
    const response = await route.fetch();
    const snapshot = await response.json() as Run;
    await route.fulfill({ response, json: { ...snapshot, status: 'FAILED', finishedAt: new Date().toISOString() } });
  });
  let requests = 0;
  await page.route(`**/api/runs/${run.id}/resume`, async route => {
    requests += 1;
    const response = await route.fetch();
    await new Promise(resolve => setTimeout(resolve, 300));
    await route.fulfill({ response });
  });
  await page.reload();
  await page.getByRole('button', { name: '恢复执行', exact: true }).dblclick();
  await expect(page.getByRole('alert')).toContainText('当前执行租约仍有效');
  expect(requests).toBe(1);
  expect((await getRun(request, run.id)).status).toBe('RUNNING');
  stale = false;
  await release(request, key);
  await awaitRun(request, run.id, value => value.status === 'SUCCEEDED');
});

test('explicit resume after an old terminal run consumes the new attempt', async ({ page, request }) => {
  const key = randomUUID();
  const definition = await workflow(request, 'terminal resume workflow', [
    { id: 'http', type: 'HTTP', method: 'GET', url: `http://127.0.0.1:18082/flaky?failures=1&code=400&key=${key}`, timeoutMs: 5000 },
  ]);
  const run = await startRun(request, definition);
  const failed = await awaitRun(request, run.id, value => value.status === 'FAILED');
  await page.goto(`/runs/${run.id}`);
  await caughtUp(page, failed);
  await page.getByRole('button', { name: '恢复执行', exact: true }).click();
  const completed = await awaitRun(request, run.id, value => value.status === 'SUCCEEDED');
  expect(completed.nodes[0].attemptId).toBe(2);
  expect(completed.nodes[0].attempts.map(attempt => attempt.status)).toEqual(['FAILED', 'SUCCEEDED']);
  await caughtUp(page, completed);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('已成功');
});

test('manual review resume never blindly repeats an unknown external write', async ({ page, request }) => {
  const key = randomUUID();
  const definition = await workflow(request, 'manual-review workflow', [
    { id: 'write', type: 'HTTP', method: 'POST', url: `http://127.0.0.1:18082/fail?code=503&key=${key}`, body: 'synthetic report', timeoutMs: 2000 },
  ]);
  const run = await startRun(request, definition);
  await awaitRun(request, run.id, value => value.status === 'MANUAL_REVIEW');
  await page.goto(`/runs/${run.id}`);
  await expect(page.getByText('运行需要人工核查外部操作；重新恢复仍会先核查原幂等键。')).toBeVisible();
  await page.getByRole('button', { name: '恢复执行', exact: true }).click();
  const reviewed = await awaitRun(request, run.id, value => value.status === 'MANUAL_REVIEW' && value.nodes[0].attemptId === 2);
  expect(reviewed.nodes[0].status).toBe('MANUAL_REVIEW');
  const demo = await (await request.get(`${control}/demo/status`)).json();
  expect(demo.counts[key]).toBe(1);
});

test('history exceeding one thousand real events is paginated and completely projected', async ({ page, request }) => {
  const nodes: NodeDefinition[] = Array.from({ length: 30 }, (_, index) => ({ id: `model_${index}`, type: 'LLM', modelRef: 'mock-demo', systemPrompt: 'synthetic pagination acceptance', userPrompt: '${input.document}', timeoutMs: 60000 }));
  const definition = await workflow(request, 'real paginated history workflow', nodes);
  const run = await startRun(request, definition, 'fixed-data-'.repeat(1800));
  const completed = await awaitRun(request, run.id, value => value.status === 'SUCCEEDED', 70000);
  expect(completed.lastEventSeq).toBeGreaterThan(1000);
  const requestedCursors: number[] = [];
  page.on('request', browserRequest => {
    if (browserRequest.url().includes(`/api/runs/${run.id}/events/history`)) requestedCursors.push(Number(new URL(browserRequest.url()).searchParams.get('after')));
  });
  await page.goto(`/runs/${run.id}`);
  await caughtUp(page, completed);
  expect(requestedCursors).toContain(0);
  expect(requestedCursors).toContain(1000);
  const events = await history(request, run.id);
  expect(events).toHaveLength(completed.lastEventSeq);
  expect(events.map(event => event.seq)).toEqual(Array.from({ length: completed.lastEventSeq }, (_, index) => index + 1));
  const region = page.getByRole('region', { name: '执行事件时间线' });
  expect(await region.locator('[data-event-row]').count()).toBeLessThanOrEqual(100);
  await region.evaluate(element => { element.scrollTop = element.scrollHeight; });
  await expect(region.locator(`[data-event-seq="${completed.lastEventSeq}"]`)).toBeVisible();
});

test('ten thousand fixed events expose the first and last rows with bounded virtual DOM', async ({ page }) => {
  await page.goto('/performance?mode=virtual&count=10000');
  const region = page.getByRole('region', { name: '执行事件时间线' });
  await expect(region.locator('[data-event-seq="1"]')).toBeVisible();
  expect(await region.locator('[data-event-row]').count()).toBeLessThanOrEqual(100);
  await region.evaluate(element => { element.scrollTop = element.scrollHeight; });
  await expect(region.locator('[data-event-seq="10000"]')).toBeVisible();
  expect(await region.locator('[data-event-row]').count()).toBeLessThanOrEqual(100);
  await page.goto('/performance?mode=plain&count=10000');
  await expect(page.locator('[data-event-row]')).toHaveCount(10000);
});
