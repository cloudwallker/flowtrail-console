import { expect, test } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readdir, readFile, rmdir, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { createServer as createHttpServer, get, type IncomingMessage, type ServerResponse } from 'node:http';
import { createServer as createViteServer, preview, type ProxyOptions } from 'vite';
import { startTool } from '../scripts/runtime.mjs';
import viteConfig from '../vite.config';

const control = 'http://127.0.0.1:18083';
const backend = 'http://127.0.0.1:18081';

test('development and preview proxies close a broken upstream SSE connection', async () => {
  for (const mode of ['development', 'preview'] as const) {
    let stream: ServerResponse | undefined;
    const upstream = createHttpServer((request, response) => {
      if (request.url === '/api/error') {
        response.writeHead(404, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify({ code: 'NOT_FOUND' }));
      } else if (request.url === '/api/unavailable') {
        request.socket.destroy();
      } else {
        stream = response;
        response.writeHead(200, { 'Content-Type': 'text/event-stream' });
        response.write(': ready\n\n');
      }
    });
    await new Promise<void>(resolve => upstream.listen(0, '127.0.0.1', resolve));
    const address = upstream.address();
    if (!address || typeof address === 'string') throw new Error('HTTP probe did not bind.');
    const existing = (mode === 'development' ? viteConfig.server : viteConfig.preview)?.proxy?.['/api'] as ProxyOptions;
    const proxy = { '/api': { ...existing, target: `http://127.0.0.1:${address.port}` } };
    const common = { configFile: false as const, logLevel: 'silent' as const };
    const server = mode === 'development'
      ? await createViteServer({ ...common, server: { host: '127.0.0.1', port: 0, strictPort: true, proxy } })
      : await preview({ ...common, preview: { host: '127.0.0.1', port: 0, strictPort: true, proxy } });
    let client: IncomingMessage | undefined;
    try {
      if (mode === 'development' && 'listen' in server) await server.listen();
      const bound = server.httpServer?.address();
      if (!bound || typeof bound === 'string') throw new Error('Vite proxy probe did not bind.');
      const origin = `http://127.0.0.1:${bound.port}`;
      const errorResponse = await fetch(`${origin}/api/error`);
      expect(errorResponse.status, `${mode} preserves JSON errors`).toBe(404);
      expect(await errorResponse.json()).toEqual({ code: 'NOT_FOUND' });
      expect((await fetch(`${origin}/api/unavailable`)).status, `${mode} preserves pre-header 502 handling`).toBe(502);
      client = await new Promise<IncomingMessage>((resolve, reject) => {
        get(`${origin}/api/events`, resolve).once('error', reject);
      });
      expect(client.statusCode).toBe(200);
      const disconnected = new Promise<boolean>(resolve => {
        client!.once('aborted', () => resolve(true));
        client!.once('end', () => resolve(true));
        client!.once('error', () => resolve(true));
        client!.resume();
      });
      stream!.destroy();
      expect(await Promise.race([disconnected, new Promise<boolean>(resolve => setTimeout(() => resolve(false), 2000))]), `${mode} forwards upstream disconnect after SSE headers`).toBe(true);
    } finally {
      client?.destroy();
      stream?.destroy();
      if ('close' in server) await server.close();
      else await new Promise<void>(resolve => server.httpServer.close(() => resolve()));
      upstream.closeAllConnections();
      await new Promise<void>(resolve => upstream.close(() => resolve()));
    }
  }
});

test('standalone Node entry points can locate npm without npm_execpath', () => {
  const env = { ...process.env };
  delete env.npm_execpath;
  const moduleUrl = new URL('../scripts/runtime.mjs', import.meta.url).href;
  const probe = spawnSync(process.execPath, ['--input-type=module', '-e', `import {runNpm} from ${JSON.stringify(moduleUrl)}; await runNpm(['--version']);`], { env, encoding: 'utf8', timeout: 20000, windowsHide: true });
  expect(probe.status, probe.stderr).toBe(0);
  expect(probe.stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/);
});

test('Windows batch paths and arguments retain spaces', async () => {
  test.skip(process.platform !== 'win32', 'Windows batch launch boundary');
  const directory = await mkdtemp(join(tmpdir(), 'flowtrail runtime batch-'));
  const script = join(directory, 'arguments probe.cmd');
  await writeFile(script, '@echo off\r\nnode -e "process.stdout.write(JSON.stringify(process.argv.slice(1)))" %*\r\n');
  try {
    const child = startTool(script, ['first argument', 'second argument'], { stdio: 'pipe' });
    let output = ''; let error = '';
    child.stdout.on('data', (chunk: Buffer) => { output += chunk; });
    child.stderr.on('data', (chunk: Buffer) => { error += chunk; });
    const code = await new Promise<number | null>((resolve, reject) => { child.once('error', reject); child.once('exit', resolve); });
    expect(code, error).toBe(0);
    expect(JSON.parse(output)).toEqual(['first argument', 'second argument']);
  } finally {
    await unlink(script);
    await rmdir(directory);
  }
});

test('the isolated test harness owns a live Java backend', async ({ request }) => {
  const response = await request.get(`${control}/health`, { timeout: 2000 }).catch(() => null);
  expect(response?.status(), 'the local process controller must start the real isolated Java service').toBe(200);
  if (!response) return;
  const status = await response.json();
  expect(status.backendReady).toBe(true);
  expect(status.backendPid).toBeGreaterThan(0);
  const health = await request.get(`${backend}/api/health`);
  expect(health.status()).toBe(200);
  expect(await health.json()).toMatchObject({ status: 'UP', service: 'flowtrail-server' });
});

test('the runnable JAR serves React deep links and preserves API 404 responses', async ({ request }) => {
  const dist = join(process.cwd(), 'dist');
  const expectedFiles = (await readdir(dist, { recursive: true, withFileTypes: true })).filter(entry => entry.isFile()).map(entry => relative(dist, join(entry.parentPath, entry.name)).replaceAll('\\', '/')).sort();
  const jar = process.env.JAVA_HOME ? join(process.env.JAVA_HOME, 'bin', process.platform === 'win32' ? 'jar.exe' : 'jar') : 'jar';
  const archive = spawnSync(jar, ['tf', join(process.cwd(), 'server', 'target', 'flowtrail-server.jar')], { encoding: 'utf8', windowsHide: true });
  expect(archive.status, archive.stderr).toBe(0);
  const prefix = 'BOOT-INF/classes/static/';
  const distributedFiles = archive.stdout.split(/\r?\n/).filter(path => path.startsWith(prefix) && !path.endsWith('/')).map(path => path.slice(prefix.length)).sort();
  expect(distributedFiles, 'production JAR must contain exactly the current dist, without stale hashed assets').toEqual(expectedFiles);
  const document = await request.get(`${backend}/runs/production-deep-link`);
  expect(document.status()).toBe(200);
  expect(document.headers()['content-type']).toContain('text/html');
  const html = await document.text();
  expect(html).toContain('<div id="root"></div>');
  const asset = html.match(/src="([^"]+\/assets\/[^\"]+\.js)"/)
    || html.match(/src="(\/assets\/[^\"]+\.js)"/);
  expect(asset, 'the JAR must contain the generated React production assets').not.toBeNull();
  if (asset) expect((await request.get(`${backend}${asset[1]}`)).status()).toBe(200);
  const license = await request.get(`${backend}/third-party-licenses.txt`);
  expect(license.status(), 'production distribution retains frontend dependency notices').toBe(200);
  expect(await license.text()).toBe(await readFile(join(process.cwd(), 'docs', 'frontend-licenses.txt'), 'utf8'));
  const missing = await request.get(`${backend}/api/runs/missing-production-resource`);
  expect(missing.status()).toBe(404);
  expect(missing.headers()['content-type']).toContain('application/json');
});
