// Aplica en orden las migraciones de api/migrations que aún no se ejecutaron.
import { readdir, readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { createDb } from './db.js';

const DIR = new URL('./migrations/', import.meta.url);

export async function migrate(db, log = () => {}) {
  await db.exec(`create table if not exists schema_migrations (
    name text primary key, applied_at timestamptz not null default now())`);
  const files = (await readdir(DIR)).filter((f) => f.endsWith('.sql')).sort();
  for (const file of files) {
    const { rows } = await db.query('select 1 from schema_migrations where name = $1', [file]);
    if (rows.length) continue;
    const sql = await readFile(new URL(file, DIR), 'utf8');
    await db.exec(`begin;\n${sql}\ninsert into schema_migrations (name) values ('${file}');\ncommit;`);
    log(`Migración aplicada: ${file}`);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const db = await createDb();
  await migrate(db, console.log);
  await db.close();
  console.log('Migraciones al día.');
}
