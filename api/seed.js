// Carga inicial: compañías, necesidades y campañas desde /data.
// Con DEMO_DATA=true también carga las cifras referenciales y movimientos de ejemplo.
// Es idempotente: no duplica compañías, necesidades ni movimientos. Las campañas sí se
// actualizan con lo que diga data/campaigns.json, porque son contenido editorial que
// cambia con las emergencias (las donaciones recibidas nunca se tocan).
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { createDb } from './db.js';
import { env } from './config.js';

const DATA = new URL('../data/', import.meta.url);
const load = async (name) => JSON.parse(await readFile(new URL(`${name}.json`, DATA), 'utf8')).data;

// Categoría de cada movimiento de ejemplo de data/impact.json (mismo orden).
const DEMO_LEDGER_CATEGORIES = [
  'Equipos de protección personal',
  'Combate de incendios',
  null,
  'Equipos de protección personal',
];

export async function seed(db, { demoData = env.demoData, log = () => {} } = {}) {
  const companies = await load('companies');
  const campaigns = await load('campaigns');

  await db.tx(async (tx) => {
    for (const c of companies) {
      await tx.query(
        `insert into companies (id, number, name, department, district, founded, address, phone, description, verified)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) on conflict (id) do nothing`,
        [c.id, c.number, c.name, c.department, c.district, c.founded, c.address, c.phone, c.description, c.verified],
      );
      for (const [i, n] of c.needs.entries()) {
        await tx.query(
          `insert into needs (id, company_id, name, detail, priority, goal, raised_offline, sort)
           values ($1,$2,$3,$4,$5,$6,$7,$8) on conflict (id) do nothing`,
          [n.id, c.id, n.name, n.detail, n.priority, n.goal, demoData ? n.raised : 0, i],
        );
      }
    }
    for (const [i, c] of campaigns.entries()) {
      await tx.query(
        `insert into campaigns (id, company_id, need_id, title, summary, category, goal, raised_offline, donors_offline,
           ends_at, status, featured, alcance, fuente, fuente_url)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
         on conflict (id) do update set
           company_id = excluded.company_id, need_id = excluded.need_id, title = excluded.title,
           summary = excluded.summary, category = excluded.category, goal = excluded.goal,
           raised_offline = excluded.raised_offline, donors_offline = excluded.donors_offline,
           ends_at = excluded.ends_at, status = excluded.status, featured = excluded.featured,
           alcance = excluded.alcance, fuente = excluded.fuente, fuente_url = excluded.fuente_url`,
        [c.id, c.companyId ?? null, c.needId ?? null, c.title, c.summary, c.category, c.goal,
          demoData ? (c.raised ?? 0) : 0, demoData ? (c.donors ?? 0) : 0, c.endsAt, c.status, i === 0,
          c.scope ?? null, c.source?.label ?? null, c.source?.url ?? null],
      );
    }
    // Una campaña que salió de data/campaigns.json se cierra (no se borra: puede tener donaciones).
    await tx.query(`update campaigns set status = 'closed' where status <> 'closed' and id <> all($1::text[])`,
      [campaigns.map((c) => c.id)]);

    if (demoData) {
      const { rows } = await tx.query('select count(*)::int as n from ledger_entries');
      if (rows[0].n === 0) {
        const { ledger } = (await load('impact'));
        for (const [i, e] of ledger.entries()) {
          await tx.query(
            `insert into ledger_entries (company_id, kind, category, concept, amount, evidence, entry_date)
             values ($1,$2,$3,$4,$5,$6,$7)`,
            [e.companyId, e.status, DEMO_LEDGER_CATEGORIES[i] ?? null, e.concept, e.amount, e.evidence, e.date],
          );
        }
      }
    }
  });
  log(`Datos iniciales cargados (${companies.length} compañías, ${campaigns.length} campañas${demoData ? ', con cifras referenciales' : ''}).`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const db = await createDb();
  await seed(db, { log: console.log });
  await db.close();
}
