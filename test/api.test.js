// Pruebas de la API con una base PGlite en memoria. Ejecutar: npm test
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createHmac } from 'node:crypto';
import { createDb } from '../api/db.js';
import { migrate } from '../api/migrate.js';
import { seed } from '../api/seed.js';
import { createApp } from '../api/app.js';
import { createGateway } from '../api/payments.js';
import { webhookSecret } from '../api/config.js';

let db;
let server;
let base;

const donor = { email: 'donante@example.com', name: '', consent: true };

async function call(method, path, body, headers = {}) {
  const res = await fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null, headers: res.headers };
}

before(async () => {
  db = await createDb({ memory: true });
  await migrate(db);
  await seed(db, { demoData: false });
  server = createServer(createApp({ db, gateway: createGateway('sandbox'), demoData: false }));
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((r) => server.close(r));
  await db.close();
});

test('health informa modo de pagos y base de datos', async () => {
  const { status, body } = await call('GET', '/api/v1/health');
  assert.equal(status, 200);
  assert.equal(body.payments, 'sandbox');
  assert.equal(body.demoData, false);
});

test('catálogo: compañías con necesidades y campañas sin cifras inventadas', async () => {
  const companies = (await call('GET', '/api/v1/companies')).body;
  assert.equal(companies.demo, false);
  assert.equal(companies.data.length, 4);
  assert.ok(companies.data.every((c) => c.needs.length === 3));
  const campaigns = (await call('GET', '/api/v1/campaigns')).body.data;
  assert.equal(campaigns.length, 5);
  assert.ok(campaigns.every((c) => c.raised === 0 && c.donors === 0));
  // Las emergencias nacionales van primero, con alcance y fuente.
  const [primera, segunda] = campaigns;
  for (const c of [primera, segunda]) {
    assert.equal(c.category, 'Incendios forestales');
    assert.equal(c.companyId, null);
    assert.ok(c.scope);
    assert.match(c.source.url, /^https:\/\//);
  }
});

test('valida monto, correo, consentimiento y destino', async () => {
  const bad = [
    [{ amount: 2, target: { type: 'general' }, donor }, 'amount'],
    [{ amount: 50, target: { type: 'general' }, donor: { ...donor, email: 'x' } }, 'email'],
    [{ amount: 50, target: { type: 'general' }, donor: { ...donor, consent: false } }, 'consent'],
    [{ amount: 50, target: { type: 'campaign', campaignId: 'NO-EXISTE' }, donor }, 'target'],
  ];
  for (const [payload, field] of bad) {
    const { status, body } = await call('POST', '/api/v1/wallet-charges', payload);
    assert.equal(status, 400);
    assert.equal(body.field, field);
  }
  assert.equal((await call('POST', '/api/v1/wallet-charges', '{malformado')).status, 400);
});

test('Yape/Plin por QR: pendiente → confirmado → suma a la campaña y al registro', async () => {
  const created = await call('POST', '/api/v1/wallet-charges', {
    amount: 75.5, target: { type: 'campaign', campaignId: 'CMP-2026-001' }, donor,
  });
  assert.equal(created.status, 201);
  assert.match(created.body.qrPayload, /^BRIGADA-ABIERTA\|PRUEBA\|BA-SUR-134-/);
  assert.equal(created.body.status, 'pending');
  assert.equal(created.body.sandbox, true);
  assert.equal(created.body.email, undefined, 'no expone el correo');

  const id = created.body.id;
  assert.equal((await call('GET', `/api/v1/wallet-charges/${id}`)).body.status, 'pending');
  assert.equal((await call('POST', `/api/v1/wallet-charges/${id}/simulate`)).body.status, 'paid');
  assert.equal((await call('GET', `/api/v1/wallet-charges/${id}`)).body.status, 'paid');

  const campaign = (await call('GET', '/api/v1/campaigns')).body.data.find((c) => c.id === 'CMP-2026-001');
  assert.equal(campaign.raised, 75.5);
  assert.equal(campaign.donors, 1);

  const impact = (await call('GET', '/api/v1/impact')).body.data;
  assert.equal(impact.metrics.find((m) => m.key === 'raised').value, 75.5);
  assert.equal(impact.ledger[0].status, 'assigned');
  assert.equal(impact.ledger[0].companyId, 'SUR-134');
});

test('campaña nacional de incendios: cobra sin compañía y no inventa asientos contables', async () => {
  const created = await call('POST', '/api/v1/wallet-charges', {
    amount: 50, target: { type: 'campaign', campaignId: 'CMP-2026-004' }, donor,
  });
  assert.equal(created.status, 201);
  assert.match(created.body.qrPayload, /BA-GEN-/);
  const antes = (await db.query('select count(*)::int as n from ledger_entries')).rows[0].n;
  assert.equal((await call('POST', `/api/v1/wallet-charges/${created.body.id}/simulate`)).body.status, 'paid');
  const despues = (await db.query('select count(*)::int as n from ledger_entries')).rows[0].n;
  assert.equal(despues, antes, 'se asigna a una compañía recién cuando se confirme el destino');
  const campaign = (await call('GET', '/api/v1/campaigns')).body.data.find((c) => c.id === 'CMP-2026-004');
  assert.equal(campaign.raised, 50);
});

test('volver a cargar los datos actualiza campañas sin duplicarlas', async () => {
  await db.query(`update campaigns set title = 'Título viejo' where id = 'CMP-2026-004'`);
  await db.query(`insert into campaigns (id, company_id, title, goal, ends_at) values ('CMP-VIEJA', 'SUR-134', 'Retirada', 10, '2027-01-01')`);
  await seed(db, { demoData: false });
  const { rows } = await db.query(`select id, title, status from campaigns where id in ('CMP-2026-004', 'CMP-VIEJA') order by id`);
  assert.equal(rows.find((r) => r.id === 'CMP-2026-004').title, 'Emergencia: incendios forestales en la sierra sur');
  assert.equal(rows.find((r) => r.id === 'CMP-VIEJA').status, 'closed');
  assert.equal((await call('GET', '/api/v1/campaigns')).body.data.filter((c) => c.status === 'active').length, 5);
});

test('Yape con código de aprobación y límite de intentos', async () => {
  const { body: charge } = await call('POST', '/api/v1/wallet-charges', { amount: 20, target: { type: 'general' }, donor });
  const wrong = await call('POST', `/api/v1/wallet-charges/${charge.id}/approval-code`, { phone: '123', code: '1' });
  assert.equal(wrong.status, 400);
  assert.equal(wrong.body.field, 'phone');
  const ok = await call('POST', `/api/v1/wallet-charges/${charge.id}/approval-code`, { phone: '987654321', code: '123456' });
  assert.equal(ok.body.status, 'paid');
  const again = await call('POST', `/api/v1/wallet-charges/${charge.id}/approval-code`, { phone: '987654321', code: '123456' });
  assert.equal(again.status, 409);
});

test('un cobro vencido no se puede pagar', async () => {
  const { body: charge } = await call('POST', '/api/v1/wallet-charges', { amount: 30, target: { type: 'general' }, donor });
  await db.query(`update donations set expires_at = now() - interval '1 minute' where id = $1`, [charge.id]);
  assert.equal((await call('GET', `/api/v1/wallet-charges/${charge.id}`)).body.status, 'expired');
  const pay = await call('POST', `/api/v1/wallet-charges/${charge.id}/approval-code`, { phone: '987654321', code: '123456' });
  assert.equal(pay.status, 409);
});

test('tarjeta en sandbox se registra como pagada', async () => {
  const { status, body } = await call('POST', '/api/v1/donations', {
    amount: 100, method: 'card', target: { type: 'company', companyId: 'BAR-016' }, donor,
  });
  assert.equal(status, 201);
  assert.equal(body.status, 'paid');
  assert.equal(body.method, 'card');
});

test('webhook: rechaza firma inválida, confirma pago y es idempotente', async () => {
  const { body: charge } = await call('POST', '/api/v1/wallet-charges', { amount: 40, target: { type: 'company', companyId: 'LAM-096' }, donor });
  const { rows: [row] } = await db.query('select gateway_ref from donations where id = $1', [charge.id]);
  const event = JSON.stringify({ eventId: 'evt_1', type: 'charge.paid', gatewayRef: row.gateway_ref });

  assert.equal((await call('POST', '/api/v1/webhooks/payments', event, { 'X-Signature': 'falsa' })).status, 401);

  const signature = createHmac('sha256', webhookSecret()).update(event).digest('hex');
  const first = await call('POST', '/api/v1/webhooks/payments', event, { 'X-Signature': signature });
  assert.equal(first.status, 200);
  assert.equal((await call('GET', `/api/v1/wallet-charges/${charge.id}`)).body.status, 'paid');

  const dup = await call('POST', '/api/v1/webhooks/payments', event, { 'X-Signature': signature });
  assert.equal(dup.body.duplicate, true);
  const { rows } = await db.query('select count(*)::int as n from ledger_entries where donation_id = $1', [charge.id]);
  assert.equal(rows[0].n, 1, 'un solo asiento contable');
});

test('el registro contable no se puede modificar ni borrar', async () => {
  await assert.rejects(db.query('update ledger_entries set amount = 0'), /solo inserción/);
  await assert.rejects(db.query('delete from ledger_entries'), /solo inserción/);
});

test('solo publica la página: server.js, docs y legacy no son accesibles', async () => {
  for (const path of ['/server.js', '/docs/AUDITORIA.md', '/legacy/brigada-abierta_v0.1.html', '/package.json', '/../package.json']) {
    assert.equal((await fetch(base + path)).status, 404, path);
  }
  const res = await fetch(`${base}/`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-security-policy'), /default-src 'self'/);
});
