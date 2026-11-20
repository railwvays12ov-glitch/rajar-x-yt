import path from 'node:path';
import type { AppConfig } from '../config.js';
import { logger } from '../logger.js';
import { AccountsOnlyStore } from './accountsOnlyStore.js';
import { MemoryStore } from './memoryStore.js';
import type { Store } from './store.js';

/**
 * Chooses the persistence layer:
 *   DATABASE_URL=postgres://…        → PostgreSQL
 *   DATABASE_URL=file:/path/db.json  → single-file database (default when hosted)
 *   DATABASE_URL=memory              → in-memory (tests / throwaway demos)
 *   (empty)                          → file database in the data directory
 */
/** Only account data is persisted; activity, audit and media never are (see AccountsOnlyStore). */
export async function createStore(config: AppConfig): Promise<Store> {
  return new AccountsOnlyStore(await createAccountStore(config));
}

async function createAccountStore(config: AppConfig): Promise<Store> {
  const url = config.databaseUrl.trim();
  if (url === 'memory' || (!url && config.env === 'test')) {
    logger.warn('DATABASE_URL=memory — data is lost on restart.');
    return new MemoryStore();
  }
  if (/^postgres(ql)?:\/\//i.test(url)) {
    const { PgStore } = await import('./pgStore.js');
    const store = new PgStore(url);
    await waitForPostgres(store);
    await applyMigrations(url);
    logger.info('Connected to PostgreSQL');
    return store;
  }
  const file = url.startsWith('file:') ? url.slice('file:'.length) : path.join(config.dataDir, 'database.json');
  const { FileStore } = await import('./fileStore.js');
  const store = new FileStore(path.resolve(file));
  await store.ping();
  logger.info('Using file database (no PostgreSQL/Redis needed)', { file: path.resolve(file) });
  return store;
}

/** A database container may still be starting (e.g. RAJAR X HOSTING Postgres add-on): retry for ~60 s. */
async function waitForPostgres(store: { ping(): Promise<void> }) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      await store.ping();
      return;
    } catch (err) {
      if (attempt >= 30) throw err;
      logger.warn('PostgreSQL not ready yet, retrying', { attempt });
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
}

/** Creates/updates the tables automatically on start (no manual "db:migrate" step needed). */
async function applyMigrations(url: string) {
  const [{ drizzle }, { migrate }, pg, { existsSync }, { fileURLToPath }] = await Promise.all([
    import('drizzle-orm/node-postgres'),
    import('drizzle-orm/node-postgres/migrator'),
    import('pg'),
    import('node:fs'),
    import('node:url'),
  ]);
  const here = path.dirname(fileURLToPath(import.meta.url));
  const folder = [
    path.resolve(here, '../../migrations'),
    path.resolve(here, '../../../../migrations'),
    path.resolve('migrations'),
  ].find((candidate) => existsSync(path.join(candidate, 'meta/_journal.json')));
  if (!folder) {
    logger.warn('Migrations folder not found — skipping automatic migration.');
    return;
  }
  const pool = new pg.default.Pool({ connectionString: url, max: 1 });
  try {
    await migrate(drizzle(pool), { migrationsFolder: folder });
    logger.info('Database migrations applied');
  } finally {
    await pool.end();
  }
}
