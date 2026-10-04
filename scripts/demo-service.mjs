import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

export async function startDemoService({ port = 18082 } = {}) {
  const records = [];
  const counts = new Map();
  const gates = new Map();
  const timers = new Set();
  let nextId = 1;
  const json = (response, code, value) => {
    if (response.destroyed || response.writableEnded) return;
    response.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    response.end(JSON.stringify(value));
  };
  const server = createServer((request, response) => {
    const url = new URL(request.url, `http://127.0.0.1:${port}`);
    if (url.pathname === '/health') return json(response, 200, { status: 'UP', service: 'flowtrail-local-demo' });
    const key = url.searchParams.get('key') || url.pathname;
    const count = (counts.get(key) || 0) + 1;
    counts.set(key, count);
    const record = { id: nextId++, method: request.method, path: url.pathname, key, count, startedAt: new Date().toISOString(), completed: false, disconnected: false };
    records.push(record);
    if (records.length > 200) records.shift();
    response.once('close', () => { if (!record.completed) record.disconnected = true; });
    const complete = (code = 200) => { record.completed = true; json(response, code, { message: '本地 HTTP 节点已完成', key, request: count }); };
    if (url.pathname === '/gate') {
      const waiters = gates.get(key) || new Set();
      waiters.add(complete); gates.set(key, waiters);
      response.once('close', () => { waiters.delete(complete); });
      return;
    }
    if (url.pathname === '/fail') return complete(Math.max(400, Math.min(599, Number(url.searchParams.get('code')) || 503)));
    if (url.pathname === '/flaky') {
      const failureCode = Math.max(400, Math.min(599, Number(url.searchParams.get('code')) || 503));
      return complete(count <= (Number(url.searchParams.get('failures')) || 2) ? failureCode : 200);
    }
    if (url.pathname === '/slow' || url.pathname === '/write') {
      const ms = Math.max(0, Math.min(20000, Number(url.searchParams.get('delay')) || 8000));
      const timer = setTimeout(() => { timers.delete(timer); complete(); }, ms);
      timers.add(timer);
      response.once('close', () => { clearTimeout(timer); timers.delete(timer); });
      return;
    }
    return complete(200);
  });
  await new Promise((resolvePromise, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolvePromise); });
  return {
    status: () => ({ records: records.map((record) => ({ ...record })), counts: Object.fromEntries(counts), gates: Object.fromEntries([...gates].map(([key, waiters]) => [key, waiters.size])) }),
    reset: () => { records.length = 0; counts.clear(); },
    release: (key) => { const waiters = gates.get(key); const count = waiters?.size || 0; for (const complete of waiters || []) complete(); gates.delete(key); return count; },
    close: async () => { for (const timer of timers) clearTimeout(timer); timers.clear(); server.closeAllConnections(); await new Promise((resolvePromise) => server.close(resolvePromise)); },
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const demo = await startDemoService();
  console.log('FlowTrail demo: http://127.0.0.1:18082');
  const close = async () => { await demo.close(); process.exit(0); };
  process.once('SIGINT', () => void close()); process.once('SIGTERM', () => void close());
}
