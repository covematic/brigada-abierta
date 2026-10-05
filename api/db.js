// Acceso a PostgreSQL con una interfaz mínima común:
//   query(sql, params) · exec(sqlMultiple) · tx(fn) · close()
// Producción: `pg` contra DATABASE_URL. Desarrollo/pruebas: PGlite (Postgres real en WASM).
import { env } from './config.js';

async function createPostgres(url) {
  const { default: pg } = await import('pg');
  const pool = new pg.Pool({
    connectionString: url,
    ssl: env.databaseSsl ? { rejectUnauthorized: false } : undefined,
    max: 10,
  });
  return {
    kind: 'postgres',
    query: (text, params) => pool.query(text, params),
    exec: (text) => pool.query(text),
    async tx(fn) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await fn({ query: (t, p) => client.query(t, p) });
        await client.query('COMMIT');
        return result;
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    },
    close: () => pool.end(),
  };
}

async function createPGlite({ memory }) {
  const { PGlite } = await import('@electric-sql/pglite');
  if (!memory) {
    const { mkdir } = await import('node:fs/promises');
    await mkdir(env.localDbDir, { recursive: true });
  }
  const db = memory ? new PGlite() : new PGlite(env.localDbDir);
  await db.waitReady;
  return {
    kind: memory ? 'pglite-memory' : 'pglite',
    query: (text, params) => db.query(text, params),
    exec: (text) => db.exec(text),
    tx: (fn) => db.transaction((tx) => fn({ query: (t, p) => tx.query(t, p) })),
    close: () => db.close(),
  };
}

/** @param {{ memory?: boolean }} options  memory=true crea una base temporal (pruebas). */
export async function createDb({ memory = false } = {}) {
  if (!memory && env.databaseUrl) return createPostgres(env.databaseUrl);
  if (env.isProduction) throw new Error('DATABASE_URL es obligatorio en producción.');
  return createPGlite({ memory });
}
