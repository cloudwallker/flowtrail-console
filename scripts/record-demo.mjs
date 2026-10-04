import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from '@playwright/test';
import { backendUrl, controlUrl, ensurePortsAvailable, rootDir, runTool, startTool, stopChild, waitForHttp } from './runtime.mjs';

// This is an evidence generator, never a production process-control endpoint.
// Build first. It owns an isolated test stack and only terminates that child tree.
let harness;
let browser;
let context;
const output = join(rootDir, 'docs', 'demo');
const images = join(rootDir, 'docs', 'images');
const rawVideo = join(rootDir, 'artifacts', 'local', 'recording');
async function json(path, body) {
  const response = await fetch(path, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!response.ok) throw new Error(`Evidence request failed: ${response.status} ${new URL(path).pathname}`);
  return response.json();
}
async function until(read, predicate, timeout = 60000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const value = await read(); if (predicate(value)) return value;
    await delay(200);
  }
  throw new Error('Evidence condition timed out.');
}
async function caption(page, text) {
  await page.evaluate(value => {
    let element = document.getElementById('demo-caption');
    if (!element) {
      element = document.createElement('div'); element.id = 'demo-caption'; document.body.append(element);
      element.style.cssText = 'position:fixed;left:280px;right:28px;bottom:20px;z-index:10000;background:#102d33;color:white;padding:16px 22px;border-radius:12px;font:600 18px system-ui;box-shadow:0 5px 24px #0004;pointer-events:none';
    }
    element.textContent = value;
  }, text);
}

try {
  await ensurePortsAvailable([18081, 18082, 18083, 4173]);
  await Promise.all([mkdir(output, { recursive: true }), mkdir(images, { recursive: true }), mkdir(rawVideo, { recursive: true })]);
  harness = startTool(process.execPath, [join(rootDir, 'scripts', 'test-server.mjs')]);
  await waitForHttp(`${controlUrl}/health`, { timeout: 180000, child: harness });
  browser = await chromium.launch();
  context = await browser.newContext({ viewport: { width: 1440, height: 1080 }, recordVideo: { dir: rawVideo, size: { width: 1440, height: 1080 } } });
  const page = await context.newPage();
  const key = randomUUID();
  const workflow = await json(`${backendUrl}/api/workflows`, { name: '故障恢复 · 报告流水线', nodes: [
    { id: 'checkpoint', type: 'TEXT', text: '已保存演示报告：${input.document}' },
    { id: 'slow_http', type: 'HTTP', dependsOn: ['checkpoint'], method: 'GET', url: `http://127.0.0.1:18082/gate?key=${key}`, timeoutMs: 30000 },
    { id: 'result', type: 'TEXT', dependsOn: ['slow_http'], text: '${checkpoint.output} / HTTP 调用完成' },
  ] });
  const response = await fetch(`${backendUrl}/api/workflows/${workflow.id}/runs`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': randomUUID() }, body: JSON.stringify({ inputs: { document: '合成测试数据，不含真实用户信息' } }) });
  assert.equal(response.status, 202); const created = await response.json();
  const readRun = () => json(`${backendUrl}/api/runs/${created.id}`);
  const before = await until(readRun, run => run.nodes.find(node => node.id === 'checkpoint')?.status === 'SUCCEEDED' && run.nodes.find(node => node.id === 'slow_http')?.status === 'RUNNING');
  await page.goto(`${backendUrl}/runs/${created.id}`);
  await page.locator('.connection-bar').getByText('实时连接', { exact: true }).waitFor();
  await caption(page, '1 / 4 · 检查点已成功，HTTP 节点仍在执行。接下来强杀隔离的 Java 进程。');
  await delay(4000);
  const oldProcess = await json(`${controlUrl}/health`);
  const crash = await json(`${controlUrl}/crash`, {});
  assert.equal(crash.crashedPid, oldProcess.backendPid);
  await page.locator('.connection-bar').getByText('连接重试中', { exact: true }).waitFor();
  await caption(page, '2 / 4 · Java 进程已被强制终止。浏览器保留已确认状态，从连续游标重连。');
  await delay(4000);
  const restarted = await json(`${controlUrl}/restart`, {});
  assert.notEqual(restarted.backendPid, oldProcess.backendPid); assert.equal(restarted.sameIsolatedDatabase, true);
  await until(readRun, run => run.nodes.find(node => node.id === 'slow_http')?.attemptId === 2 && run.nodes.find(node => node.id === 'slow_http')?.status === 'RUNNING');
  await caption(page, '3 / 4 · 同一数据库重启后恢复：保留成功检查点，HTTP 从尝试 #2 继续。');
  await delay(4000);
  await json(`${controlUrl}/demo/release`, { key });
  const after = await until(readRun, run => run.status === 'SUCCEEDED');
  await page.locator('.event-panel .tag').filter({ hasText: `cursor #${after.lastEventSeq}` }).waitFor();
  await page.locator('.connection-bar').getByText('已追平终态', { exact: true }).waitFor();
  const events = []; for (;;) {
    const portion = await json(`${backendUrl}/api/runs/${created.id}/events/history?after=${events.at(-1)?.seq ?? 0}`);
    events.push(...portion); if (portion.length < 1000) break;
  }
  assert.deepEqual(events.map(event => event.seq), Array.from({ length: after.lastEventSeq }, (_, index) => index + 1));
  const checkpoint = after.nodes.find(node => node.id === 'checkpoint');
  const resumed = after.nodes.find(node => node.id === 'slow_http');
  assert.equal(checkpoint.attempts.length, 1);
  assert.deepEqual(resumed.attempts.map(attempt => [attempt.attemptId, attempt.status]), [[1, 'INTERRUPTED'], [2, 'SUCCEEDED']]);
  await caption(page, '4 / 4 · 已成功并追平全部事件。成功检查点只有一次执行，旧中断尝试仍可查看。');
  await delay(4000);
  await page.getByRole('button', { name: /slow_http/ }).click();
  await page.getByRole('dialog', { name: '节点 · slow_http' }).waitFor();
  await delay(4000);
  await page.screenshot({ path: join(images, 'recovery-attempts.png') });
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  await page.evaluate(() => document.getElementById('demo-caption')?.remove());
  await page.screenshot({ path: join(images, 'console-desktop.png'), fullPage: true });
  await writeFile(join(output, 'recovery-evidence.json'), JSON.stringify({ recordedAt: new Date().toISOString(), fault: 'forced termination of the isolated Java process', syntheticInput: true, oldPid: oldProcess.backendPid, newPid: restarted.backendPid, sameIsolatedDatabase: true, assertions: { checkpointExecutedOnce: true, interruptedAttemptRetained: true, resumedAttemptSucceeded: true, contiguousEvents: true, terminalWatermarkConsumed: true }, before, after, events }, null, 2) + '\n');
  const video = page.video();
  await context.close(); context = undefined;
  const rawPath = await video.path();
  await runTool(process.env.FLOWTRAIL_FFMPEG || 'ffmpeg', ['-y', '-i', rawPath, '-map_metadata', '-1', '-an', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '25', '-movflags', '+faststart', join(output, 'recovery.mp4')]);
  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await mobile.goto(`${backendUrl}/runs/${created.id}`);
  await mobile.locator('.connection-bar').getByText('已追平终态', { exact: true }).waitFor();
  assert.equal(await mobile.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await mobile.screenshot({ path: join(images, 'console-mobile.png'), fullPage: true });
  console.log('Recorded an actual process crash, successful checkpoint reuse, contiguous replay and responsive screenshots.');
} catch (error) {
  console.error(error.message); process.exitCode = 1;
} finally {
  await context?.close(); await browser?.close(); await stopChild(harness);
}
