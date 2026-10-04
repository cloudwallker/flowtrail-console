import { runMaven, runNpm } from './runtime.mjs';

try {
  await runNpm(['run', 'build']);
  await runMaven(['clean', 'verify']);
  console.log('Runnable console: server/target/flowtrail-server.jar');
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
