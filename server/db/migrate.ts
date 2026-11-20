/**
 * Applies SQL migrations in ./migrations. Usage: `npm run db:migrate`
 * (inside Docker: `docker compose exec app node dist/server/server/db/migrate.js`).
 */
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is required to run migrations.');
  process.exit(1);
}

const here = path.dirname(fileURLToPath(import.meta.url));
const candidates = [path.resolve(here, '../../migrations'), path.resolve(here, '../../../../migrations')];
const { existsSync } = await import('node:fs');
const migrationsFolder = candidates.find((p) => existsSync(path.join(p, 'meta/_journal.json')));
if (!migrationsFolder) {
  console.error('Could not locate the migrations folder.');
  process.exit(1);
}

const pool = new pg.Pool({ connectionString: url, max: 1 });
try {
  await migrate(drizzle(pool), { migrationsFolder });
  console.log('Migrations applied.');
} catch (err) {
  console.error('Migration failed:', (err as Error).message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
