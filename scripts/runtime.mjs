import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { access, mkdtemp } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { delimiter, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

export const rootDir = fileURLToPath(new URL('../', import.meta.url));
export const backendPort = 18081;
export const demoPort = 18082;
export const controlPort = 18083;
export const backendUrl = `http://127.0.0.1:${backendPort}`;
export const controlUrl = `http://127.0.0.1:${controlPort}`;
export const jarPath = join(rootDir, 'server', 'target', 'flowtrail-server.jar');

// Native binaries never use a shell. Windows batch launchers need cmd.exe;
// reject its expansion/control characters before building the command line.
function batchArgument(value) {
  if (/[\r\n"%!&|<>^]/.test(value)) throw new Error('Unsupported Windows batch argument.');
  return `"${value}"`;
}

function resolveBatchExecutable(executable, environment, cwd) {
  if (isAbsolute(executable) || /[\\/]/.test(executable)) {
    const file = resolve(cwd, executable);
    if (!existsSync(file)) throw new Error(`Batch executable not found: ${executable}`);
    return file;
  }
  // cmd.exe can locate a bare launcher yet expand its %~dp0 against the caller's
  // directory. Resolve the actual PATH file before asking cmd.exe to run it.
  const pathKey = Object.keys(environment).find(key => key.toLowerCase() === 'path');
  for (const directory of (environment[pathKey] || '').split(delimiter)) {
    if (!directory) continue;
    const file = join(directory.replace(/^"|"$/g, ''), executable);
    if (existsSync(file)) return resolve(file);
  }
  throw new Error(`Batch executable not found on PATH: ${executable}`);
}

export function startTool(executable, args, options = {}) {
  const environment = { ...process.env, ...options.env };
  const common = { cwd: rootDir, stdio: 'inherit', windowsHide: true, ...options, env: environment };
  if (process.platform === 'win32' && /\.cmd$/i.test(executable)) {
    const command = resolveBatchExecutable(executable, environment, common.cwd);
    const line = [command, ...args].map(batchArgument).join(' ');
    return spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `"${line}"`], { ...common, windowsVerbatimArguments: true });
  }
  return spawn(executable, args, common);
}

export function runTool(executable, args, options = {}) {
  const child = startTool(executable, args, options);
  return new Promise((resolvePromise, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => code === 0 ? resolvePromise() : reject(new Error(`${executable} failed (${signal || code}).`)));
  });
}

export function runNpm(args) {
  if (process.env.npm_execpath) return runTool(process.execPath, [process.env.npm_execpath, ...args]);
  return runTool(process.platform === 'win32' ? 'npm.cmd' : 'npm', args);
}

export function runMaven(args) {
  const command = process.env.FLOWTRAIL_MAVEN || (process.platform === 'win32' ? 'mvn.cmd' : 'mvn');
  const options = ['--batch-mode', '--no-transfer-progress', '-f', join(rootDir, 'server', 'pom.xml')];
  if (process.env.FLOWTRAIL_MAVEN_REPO) options.push(`-Dmaven.repo.local=${resolve(process.env.FLOWTRAIL_MAVEN_REPO)}`);
  if (process.env.FLOWTRAIL_MAVEN_SETTINGS) options.push('--settings', resolve(process.env.FLOWTRAIL_MAVEN_SETTINGS));
  return runTool(command, [...options, ...args]);
}

export async function buildBackend() {
  await runMaven(['-DskipTests', 'clean', 'package']);
  await access(jarPath);
}

export async function makeTestDataDirectory() {
  return mkdtemp(join(tmpdir(), 'flowtrail-console-e2e-'));
}

export async function ensurePortsAvailable(ports) {
  for (const port of ports) {
    await new Promise((resolvePromise, reject) => {
      const probe = createServer();
      probe.once('error', () => reject(new Error(`Port ${port} is occupied. Stop its owner; FlowTrail will not take over another service.`)));
      probe.listen({ host: '127.0.0.1', port, exclusive: true }, () => probe.close(resolvePromise));
    });
  }
}

export async function waitForHttp(url, { timeout = 60000, child } = {}) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (child && (child.exitCode !== null || child.signalCode !== null)) throw new Error(`Process exited before ${url} became ready.`);
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1000) });
      await response.body?.cancel();
      if (response.ok) return;
    } catch { /* Startup has not completed yet. */ }
    await delay(150);
  }
  throw new Error(`Timed out waiting for ${url}.`);
}

export function startVite({ preview = false, port = preview ? 4173 : 5173 } = {}) {
  return startTool(process.execPath, [join(rootDir, 'node_modules', 'vite', 'bin', 'vite.js'), ...(preview ? ['preview'] : []), '--host', '127.0.0.1', '--port', String(port), '--strictPort']);
}

export function startBackend({ dataDirectory, testMode = false } = {}) {
  const java = process.env.JAVA_HOME ? join(process.env.JAVA_HOME, 'bin', process.platform === 'win32' ? 'java.exe' : 'java') : 'java';
  const env = { SERVER_ADDRESS: '127.0.0.1', SERVER_PORT: String(backendPort) };
  const flags = [];
  if (dataDirectory) {
    env.FLOWTRAIL_DB_URL = `jdbc:h2:async:${join(dataDirectory, 'runtime').replaceAll('\\', '/')};DB_CLOSE_ON_EXIT=FALSE;WRITE_DELAY=0`;
    env.FLOWTRAIL_DB_USER = 'sa';
    env.FLOWTRAIL_DB_PASSWORD = '';
  }
  if (testMode) {
    env.FLOWTRAIL_MODEL_API_KEY = '';
    flags.push('--flowtrail.runtime.lease-seconds=2', '--flowtrail.runtime.retry-delays-ms=30,60', '--flowtrail.runtime.workers=16', '--flowtrail.runtime.per-run=16', '--flowtrail.runtime.queue-capacity=64');
  }
  return startTool(java, ['-jar', jarPath, ...flags], { cwd: join(rootDir, 'server'), env });
}

export async function stopChild(child, { force = false } = {}) {
  if (!child?.pid || child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise((resolvePromise) => child.once('exit', resolvePromise));
  if (process.platform === 'win32') {
    // Only the PID returned by our own spawn is eligible for termination.
    const killer = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
    await new Promise((resolvePromise) => { killer.once('error', resolvePromise); killer.once('exit', resolvePromise); });
  } else {
    child.kill(force ? 'SIGKILL' : 'SIGTERM');
    if (!force) {
      await Promise.race([exited, delay(5000)]);
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    }
  }
  await Promise.race([exited, delay(5000)]);
}

export function installShutdown(cleanup) {
  let exiting = false;
  const shutdown = async (code = 0) => {
    if (exiting) return;
    exiting = true;
    try { await cleanup(); } finally { process.exit(code); }
  };
  process.once('SIGINT', () => void shutdown());
  process.once('SIGTERM', () => void shutdown());
  return shutdown;
}
