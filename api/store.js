// Consultas a la base de datos. Ninguna otra parte del backend escribe SQL.
import { randomUUID, getRandomValues } from 'node:crypto';

const num = (v) => (v === null || v === undefined ? 0 : Number(v));
const isoDate = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10));

export function createTraceCode(targetId = 'GEN') {
  const rand = new Uint32Array(1);
  getRandomValues(rand);
  const time = Date.now().toString(36).toUpperCase();
  const tail = rand[0].toString(36).toUpperCase().padStart(6, '0').slice(-6);
  return `BA-${targetId}-${time}-${tail}`;
}

// ---------- Catálogo ----------

export async function listCompanies(db) {
  const { rows: companies } = await db.query('select * from companies order by number::int desc');
  const { rows: needs } = await db.query(`
    select n.*,
      n.raised_offline + coalesce((
        select sum(d.amount) from donations d
        join campaigns c on c.id = d.campaign_id
        where c.need_id = n.id and d.status = 'paid'), 0) as raised
    from needs n order by n.company_id, n.sort`);
  return companies.map((c) => ({
    id: c.id,
    number: c.number,
    name: c.name,
    department: c.department,
    district: c.district,
    founded: c.founded,
    address: c.address,
    phone: c.phone,
    verified: c.verified,
    description: c.description,
    needs: needs.filter((n) => n.company_id === c.id).map((n) => ({
      id: n.id, name: n.name, detail: n.detail, priority: n.priority, goal: num(n.goal), raised: num(n.raised),
    })),
  }));
}

export async function listCampaigns(db) {
  const { rows } = await db.query(`
    select c.*,
      c.raised_offline + coalesce(sum(d.amount) filter (where d.status = 'paid'), 0) as raised,
      c.donors_offline + count(distinct d.donor_email) filter (where d.status = 'paid') as donors
    from campaigns c
    left join donations d on d.campaign_id = c.id
    where c.status <> 'draft'
    group by c.id
    order by c.featured desc, c.ends_at`);
  return rows.map((c) => ({
    id: c.id,
    title: c.title,
    summary: c.summary,
    companyId: c.company_id,
    needId: c.need_id,
    category: c.category,
    goal: num(c.goal),
    raised: num(c.raised),
    donors: num(c.donors),
    endsAt: isoDate(c.ends_at),
    status: c.status,
    featured: c.featured,
  }));
}

export async function getImpact(db) {
  const [{ rows: [totals] }, { rows: [ledgerTotals] }, { rows: alloc }, { rows: ledger }] = await Promise.all([
    db.query(`
      select
        (select coalesce(sum(amount), 0) from donations where status = 'paid')
          + (select coalesce(sum(raised_offline), 0) from campaigns) as raised,
        (select count(distinct donor_email) from donations where status = 'paid')
          + (select coalesce(sum(donors_offline), 0) from campaigns) as donors`),
    db.query(`
      select count(distinct company_id) as companies,
             count(*) filter (where kind = 'executed') as purchases
      from ledger_entries`),
    db.query(`
      select coalesce(category, 'Otros') as label, sum(amount) as total
      from ledger_entries where kind = 'executed'
      group by 1 order by total desc`),
    db.query(`
      select l.*, c.name as company_name, c.number as company_number
      from ledger_entries l join companies c on c.id = l.company_id
      order by l.entry_date desc, l.id desc limit 8`),
  ]);

  const allocTotal = alloc.reduce((s, a) => s + num(a.total), 0);
  return {
    metrics: [
      { key: 'raised', label: 'Donaciones recibidas', value: num(totals.raised), format: 'currency' },
      { key: 'donors', label: 'Personas que donaron', value: num(totals.donors), format: 'number' },
      { key: 'companies', label: 'Compañías beneficiadas', value: num(ledgerTotals.companies), format: 'number' },
      { key: 'purchases', label: 'Compras con evidencia', value: num(ledgerTotals.purchases), format: 'number' },
    ],
    allocation: allocTotal
      ? alloc.map((a) => ({ label: a.label, percent: Math.round((num(a.total) / allocTotal) * 100) }))
      : [],
    ledger: ledger.map((e) => ({
      date: isoDate(e.entry_date),
      companyId: e.company_id,
      concept: e.concept,
      amount: num(e.amount),
      status: e.kind,
      evidence: e.evidence ?? (e.kind === 'assigned' ? 'Pendiente de compra' : ''),
    })),
  };
}

// ---------- Validación de destino ----------

export async function resolveTarget(db, target) {
  if (target.type === 'campaign') {
    const { rows } = await db.query(`select id, company_id from campaigns where id = $1 and status = 'active'`, [target.campaignId]);
    if (!rows.length) return null;
    return { type: 'campaign', campaignId: rows[0].id, companyId: rows[0].company_id };
  }
  if (target.type === 'company') {
    const { rows } = await db.query('select id from companies where id = $1', [target.companyId]);
    if (!rows.length) return null;
    return { type: 'company', campaignId: null, companyId: rows[0].id };
  }
  return { type: 'general', campaignId: null, companyId: null };
}

// ---------- Donaciones ----------

export async function insertDonation(db, input) {
  const id = randomUUID();
  const traceCode = createTraceCode(input.target.companyId ?? 'GEN');
  const { rows } = await db.query(
    `insert into donations (id, trace_code, amount, currency, method, target_type, campaign_id, company_id,
       donor_email, donor_name, anonymous, status, gateway, expires_at)
     values ($1,$2,$3,'PEN',$4,$5,$6,$7,$8,$9,$10,'pending',$11,$12)
     returning *`,
    [id, traceCode, input.amount, input.method, input.target.type, input.target.campaignId, input.target.companyId,
      input.donor.email, input.donor.name || null, !input.donor.name, input.gateway, input.expiresAt ?? null],
  );
  return rows[0];
}

export async function setGatewayData(db, id, { gatewayRef, qrPayload }) {
  const { rows } = await db.query(
    'update donations set gateway_ref = $2, qr_payload = coalesce($3, qr_payload) where id = $1 returning *',
    [id, gatewayRef, qrPayload ?? null],
  );
  return rows[0];
}

export async function getDonation(db, id) {
  const { rows } = await db.query('select * from donations where id = $1', [id]);
  return rows[0] ?? null;
}

export async function findDonationByGatewayRef(db, gatewayRef) {
  const { rows } = await db.query('select * from donations where gateway_ref = $1', [gatewayRef]);
  return rows[0] ?? null;
}

/** Marca vencida una donación pendiente cuyo plazo pasó. Devuelve el estado actual. */
export async function refreshExpiry(db, donation) {
  if (donation.status === 'pending' && donation.expires_at && new Date(donation.expires_at) < new Date()) {
    const { rows } = await db.query(
      `update donations set status = 'expired' where id = $1 and status = 'pending' returning *`, [donation.id]);
    return rows[0] ?? (await getDonation(db, donation.id));
  }
  return donation;
}

export async function incrementAttempts(db, id) {
  const { rows } = await db.query('update donations set attempts = attempts + 1 where id = $1 returning attempts', [id]);
  return rows[0]?.attempts ?? 0;
}

/**
 * Marca una donación como pagada y registra el asiento contable de asignación.
 * Idempotente: si ya estaba pagada no hace nada. Solo lo llaman el webhook de la
 * pasarela o la respuesta síncrona verificada de la pasarela (nunca el navegador).
 */
export async function markPaid(db, donationId) {
  return db.tx(async (tx) => {
    const { rows } = await tx.query(
      `update donations set status = 'paid', paid_at = now()
       where id = $1 and status = 'pending' returning *`, [donationId]);
    const donation = rows[0];
    if (!donation) return null;
    if (donation.company_id) {
      await tx.query(
        `insert into ledger_entries (company_id, donation_id, kind, concept, amount, evidence)
         values ($1, $2, 'assigned', $3, $4, 'Pendiente de compra')`,
        [donation.company_id, donation.id, `Donación ${donation.trace_code} asignada`, donation.amount],
      );
    }
    return donation;
  });
}

export async function markFailed(db, donationId) {
  await db.query(`update donations set status = 'failed' where id = $1 and status = 'pending'`, [donationId]);
}

/** Registra un evento de webhook. Devuelve false si ya se había procesado. */
export async function recordWebhookEvent(db, eventId, payload) {
  const { rows } = await db.query(
    'insert into webhook_events (id, payload) values ($1, $2) on conflict (id) do nothing returning id',
    [eventId, JSON.stringify(payload)],
  );
  return rows.length > 0;
}

/** Forma pública de una donación (sin correo ni datos internos). */
export function publicDonation(d, { sandbox }) {
  return {
    id: d.id,
    traceCode: d.trace_code,
    amount: num(d.amount),
    currency: d.currency,
    method: d.method,
    status: d.status,
    createdAt: new Date(d.created_at).toISOString(),
    expiresAt: d.expires_at ? new Date(d.expires_at).toISOString() : null,
    qrPayload: d.qr_payload ?? undefined,
    sandbox,
  };
}
