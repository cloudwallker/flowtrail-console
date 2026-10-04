import { createServer } from 'node:http';
import { startDemoService } from './demo-service.mjs';
import { backendUrl, buildBackend, controlPort, ensurePortsAvailable, installShutdown, makeTestDataDirectory, startBackend, startVite, stopChild, waitForHttp } from './runtime.mjs';

let demo;
let backend;
let ui;
let control;
let backendReady = false;
let generation = 0;
let operation = false;
const dataDirectory = await makeTestDataDirectory();
const shutdown = installShutdown(async () => {
  if (control) { control.closeAllConnections(); await new Promise((resolvePromise) => control.close(resolvePromise)); }
  await stopChild(ui); await stopChild(backend); await demo?.close();
  // Keep isolated crash evidence in the OS temporary directory. It never enters
  // the source tree or a normal user's development database.
});
const json = (response, status, body) => { response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); response.end(JSON.stringify(body)); };
const startJava = async () => {
  backendReady = false;
  await ensurePortsAvailable([18081]);
  backend = startBackend({ dataDirectory, testMode: true });
  backend.on('error', () => { backendReady = false; });
  backend.once('exit', () => { backendReady = false; });
  await waitForHttp(`${backendUrl}/api/health`, { child: backend });
  backendReady = true; generation += 1;
};

try {
  await ensurePortsAvailable([18081, 18082, 18083, 4173]);
  await buildBackend();
  demo = await startDemoService();
  await startJava();
  // E2E uses Vite's real dev server on a fixed test port, so frontend source
  // changes cannot be hidden by an old dist directory. CI also builds the JAR.
  ui = startVite({ port: 4173 });
  await waitForHttp('http://127.0.0.1:4173', { child: ui });
  ui.once('exit', () => void shutdown(1));
  control = createServer(async (request, response) => {
    const path = new URL(request.url, 'http://127.0.0.1').pathname;
    if (request.method === 'GET' && path === '/health') return json(response, 200, { backendReady, backendPid: backendReady ? backend.pid : null, generation, isolatedDatabase: true });
    if (request.method === 'GET' && path === '/demo/status') return json(response, 200, demo.status());
    if (request.method !== 'POST') return json(response, 404, { error: 'Unknown test control operation.' });
    if (operation) return json(response, 409, { error: 'A process operation is already in progress.' });
    operation = true;
    try {
      if (path === '/crash') {
        const pid = backend?.pid;
        backendReady = false;
        await stopChild(backend, { force: true });
        return json(response, 200, { crashedPid: pid, generation });
      }
      if (path === '/restart') {
        if (backendReady) return json(response, 409, { error: 'Crash the owned backend before restarting.' });
        await startJava();
        return json(response, 200, { backendPid: backend.pid, generation, sameIsolatedDatabase: true });
      }
      if (path === '/demo/reset') { demo.reset(); return json(response, 200, { reset: true }); }
      if (path === '/demo/release') {
        let body = ''; for await (const chunk of request) { body += chunk; if (body.length > 4096) throw new Error('Control payload is too large.'); }
        const { key } = JSON.parse(body || '{}');
        if (typeof key !== 'string') return json(response, 400, { error: 'A gate key is required.' });
        return json(response, 200, { released: demo.release(key) });
      }
      return json(response, 404, { error: 'Unknown test control operation.' });
    } catch { return json(response, 500, { error: 'Local test control operation failed.' }); }
    finally { operation = false; }
  });
  await new Promise((resolvePromise, reject) => { control.once('error', reject); control.listen(controlPort, '127.0.0.1', resolvePromise); });
  console.log('Isolated E2E stack ready: UI 4173, Java 18081, demo 18082, test control 18083.');
} catch (error) {
  console.error(error.message);
  await shutdown(1);
}
