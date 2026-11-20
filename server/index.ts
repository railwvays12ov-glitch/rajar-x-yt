import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { createApp } from './app.js';
import { buildContext } from './bootstrap.js';
import { loadConfig } from './config.js';
import { logger } from './logger.js';

const config = loadConfig();
const here = path.dirname(fileURLToPath(import.meta.url));
// Works from source (server/) and from the compiled output (dist/server/server/).
const clientDir = [path.resolve(here, '../dist/client'), path.resolve(here, '../../client')].find((p) =>
  existsSync(path.join(p, 'index.html')),
);

const { ctx, close } = await buildContext(config, { clientDir: clientDir ?? null });
const app = createApp(ctx);
const server = createServer(app);

server.headersTimeout = 30_000;
server.requestTimeout = 60_000;
server.keepAliveTimeout = 65_000;

server.listen(config.port, config.host, () => {
  logger.info('RAJAR X YT listening', {
    port: config.port,
    env: config.env,
    store: ctx.store.kind,
    queue: ctx.queue.driver,
    client: clientDir ? 'bundled' : 'not built (use Vite dev server)',
  });
});

let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info('Shutting down gracefully', { signal });
  const force = setTimeout(() => {
    logger.error('Forced exit after shutdown timeout');
    process.exit(1);
  }, 30_000);
  force.unref();
  server.close();
  server.closeIdleConnections?.();
  try {
    await close(); // stops intake, aborts running jobs (they return to the queue), closes DB/Redis
  } catch (err) {
    logger.error('Error during shutdown', { err });
  }
  clearTimeout(force);
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('unhandledRejection', (err) => logger.error('Unhandled rejection', { err }));
