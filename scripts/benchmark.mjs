import { chromium } from '@playwright/test';
import { writeFile, mkdir } from 'node:fs/promises';
import { cpus, platform, release, arch } from 'node:os';
import { join } from 'node:path';
import { ensurePortsAvailable, rootDir, runNpm, startVite, stopChild, waitForHttp } from './runtime.mjs';

const samples = Math.max(5, Number(process.env.FLOWTRAIL_BENCHMARK_SAMPLES) || 5);
const viewport = { width: 1440, height: 1000 };
const url = process.env.FLOWTRAIL_BENCHMARK_URL || 'http://127.0.0.1:4183';
const build = process.env.FLOWTRAIL_BENCHMARK_URL ? 'external preview; build provenance not verified by runner' : 'Vite production build';
let preview;
let browser;
const percentile = (values, fraction) => [...values].sort((a, b) => a - b)[Math.max(0, Math.ceil(values.length * fraction) - 1)];
const rounded = value => Math.round(value * 100) / 100;

try {
  if (!process.env.FLOWTRAIL_BENCHMARK_URL) {
    await runNpm(['run', 'build']);
    await ensurePortsAvailable([4183]);
    preview = startVite({ preview: true, port: 4183 });
    await waitForHttp(url, { child: preview });
  }
  browser = await chromium.launch();
  const rows = [];
  for (let round = 0; round < samples; round++) {
    const order = round % 2 ? ['virtual', 'plain'] : ['plain', 'virtual'];
    for (const mode of order) {
      // A fresh context makes both cases use an empty browser cache. Same shared row component/data.
      const context = await browser.newContext({ viewport });
      const page = await context.newPage();
      await page.addInitScript(() => {
        window.__flowtrailLongTasks = [];
        const observer = new PerformanceObserver(list => {
          for (const item of list.getEntries()) window.__flowtrailLongTasks.push({ start: item.startTime, duration: item.duration });
        });
        observer.observe({ type: 'longtask', buffered: true });
      });
      await page.goto(`${url}/performance?mode=${mode}&count=10000`);
      await page.waitForFunction(() => window.__flowtrailBenchmark?.ready);
      const mounted = await page.evaluate(() => window.__flowtrailBenchmark);
      if (mode === 'plain' && mounted.rowCount !== 10000) throw new Error('Plain baseline did not render all 10,000 events.');
      if (mode === 'virtual' && (mounted.rowCount < 1 || mounted.rowCount > 100)) throw new Error('Virtual list row count exceeded the fixed viewport contract.');
      const scroll = await page.evaluate(async () => {
        const element = document.querySelector('[data-event-list]');
        const start = performance.now();
        const frames = []; let previous;
        for (let step = 0; step <= 120; step++) {
          const now = await new Promise(resolve => requestAnimationFrame(resolve));
          if (previous !== undefined) frames.push(now - previous);
          previous = now;
          element.scrollTop = (element.scrollHeight - element.clientHeight) * (step / 120);
        }
        await new Promise(resolve => requestAnimationFrame(resolve));
        await new Promise(resolve => requestAnimationFrame(resolve));
        const end = performance.now();
        const tasks = window.__flowtrailLongTasks.filter(task => task.start >= start && task.start < end);
        return { frames, scrollLongTasks: tasks.length, scrollLongTaskMs: tasks.reduce((sum, task) => sum + task.duration, 0), finalRows: document.querySelectorAll('[data-event-row]').length };
      });
      await page.locator('[data-event-seq="10000"]').waitFor({ state: 'visible' });
      const item = { round: round + 1, mode, ...mounted, frameP95Ms: rounded(percentile(scroll.frames, 0.95)), scrollLongTasks: scroll.scrollLongTasks, scrollLongTaskMs: rounded(scroll.scrollLongTaskMs), finalRows: scroll.finalRows };
      rows.push(item);
      console.log(`round ${round + 1} ${mode}: ${item.rowCount} rows, render ${item.renderMs} ms, p95 frame ${item.frameP95Ms} ms`);
      await context.close();
    }
  }
  const summaries = Object.fromEntries(['plain', 'virtual'].map(mode => {
    const selected = rows.filter(row => row.mode === mode);
    return [mode, { renderMedianMs: rounded(percentile(selected.map(row => row.renderMs), 0.5)), renderMinMs: Math.min(...selected.map(row => row.renderMs)), renderMaxMs: Math.max(...selected.map(row => row.renderMs)), rowMedian: percentile(selected.map(row => row.rowCount), 0.5), frameP95MedianMs: rounded(percentile(selected.map(row => row.frameP95Ms), 0.5)), scrollLongTasksMedian: percentile(selected.map(row => row.scrollLongTasks), 0.5) }];
  }));
  const result = { measuredAt: new Date().toISOString(), dataset: '10,000 deterministic synthetic events; shared EventRow', build, cache: 'fresh browser context for each sample; empty browser asset cache', samplesPerMode: samples, viewport, environment: { os: `${platform()} ${release()} ${arch()}`, cpu: cpus()[0]?.model, logicalCPUs: cpus().length, node: process.version, browser: browser.version(), headless: true }, rows, summaries };
  await mkdir(join(rootDir, 'docs'), { recursive: true });
  await writeFile(join(rootDir, 'docs', 'benchmark-results.json'), JSON.stringify(result, null, 2) + '\n');
  const lines = ['# 性能对照 / Performance comparison', '', `测量时间：${result.measuredAt}。固定10,000条合成事件，同一EventRow、1440×1000视口，每种模式${samples}次交替运行。每次使用新的浏览器上下文。构建来源：${build}。`, '', `环境：${result.environment.os}；${result.environment.cpu}；Node ${result.environment.node}；Chromium ${result.environment.browser}（headless）。`, '', '| 模式 | 挂载事件行中位数 | 挂载耗时中位数 | 挂载耗时范围 | 滚动帧间隔p95中位数 | 滚动长任务中位数 |', '|---|---:|---:|---:|---:|---:|'];
  for (const [mode, summary] of Object.entries(summaries)) lines.push(`| ${mode} | ${summary.rowMedian} | ${summary.renderMedianMs} ms | ${summary.renderMinMs}–${summary.renderMaxMs} ms | ${summary.frameP95MedianMs} ms | ${summary.scrollLongTasksMedian} |`);
  lines.push('', '复现：`npm ci --legacy-peer-deps`、`npx playwright install chromium`、`npm run benchmark`。原始结果：[benchmark-results.json](benchmark-results.json)。', '', '默认脚本自动构建生产资源；设置 FLOWTRAIL_BENCHMARK_URL 时使用外部页面，脚本不确认其构建来源。', '', '挂载耗时从性能页面开始渲染，到连续两帧后的已挂载列表测量；不包含导航前的网络和脚本加载。滚动以120个动画帧从首部到尾部，记录帧间隔与主线程≥50ms长任务。测量的是合成负载，不能外推为生产流量或所有设备表现；虚拟化降低DOM数量，不等于降低全部数据的内存占用。', '', `The comparison uses the same deterministic 10,000 events and shared row component. Build source: ${build}. Modes alternate across at least five fresh browser contexts each. Mount timing excludes navigation/network before component render; the scroll script traverses the list over 120 animation frames. Raw samples and environment are recorded above. These synthetic, headless measurements are reproducible evidence, not a production throughput claim.`, '');
  await writeFile(join(rootDir, 'docs', 'performance.md'), lines.join('\n'));
} catch (error) {
  console.error(error.message); process.exitCode = 1;
} finally {
  await browser?.close(); await stopChild(preview);
}
