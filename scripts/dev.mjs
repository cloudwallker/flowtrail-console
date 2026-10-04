import { startDemoService } from './demo-service.mjs';
import { backendUrl, buildBackend, ensurePortsAvailable, installShutdown, startBackend, startVite, stopChild, waitForHttp } from './runtime.mjs';

let demo;
let backend;
let ui;
const shutdown = installShutdown(async () => { await stopChild(ui); await stopChild(backend); await demo?.close(); });
try {
  await ensurePortsAvailable([18081, 18082, 5173]);
  await buildBackend();
  demo = await startDemoService();
  backend = startBackend();
  await waitForHttp(`${backendUrl}/api/health`, { child: backend });
  ui = startVite();
  await waitForHttp('http://127.0.0.1:5173', { child: ui });
  console.log('FlowTrail Console: http://127.0.0.1:5173/workflows');
  backend.once('exit', () => void shutdown(1));
  ui.once('exit', () => void shutdown(1));
} catch (error) {
  console.error(error.message);
  await shutdown(1);
}
