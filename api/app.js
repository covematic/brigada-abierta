// Aplicación HTTP: API REST en /api/v1 + archivos de la página.
import { createHmac, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { env, webhookSecret } from './config.js';
import { createGateway } from './payments.js';
import {
  HttpError, sendJson, readRawBody, parseJson, clientIp, createRateLimiter, SECURITY_HEADERS, CSP,
} from './http.js';
import * as store from './store.js';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const PUBLIC_PATHS = [/^index\.html$/, /^assets\//, /^data\//];
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const LIMITS = { min: 5, max: 20000 };
const MAX_CODE_ATTEMPTS = 5;

// ---------- Validación ----------

function validateDonationInput(body, allowedMethods) {
  const amount = Math.round(Number(body.amount) * 100) / 100;
  if (!Number.isFinite(amount) || amount < LIMITS.min || amount > LIMITS.max) {
    throw new HttpError(400, `El monto debe estar entre S/ ${LIMITS.min} y S/ ${LIMITS.max}.`, 'amount');
  }
  if (!allowedMethods.includes(body.method)) throw new HttpError(400, 'Método de pago no válido.', 'method');

  const donor = body.donor ?? {};
  const email = String(donor.email ?? '').trim().toLowerCase();
  if (!EMAIL_RE.test(email) || email.length > 254) throw new HttpError(400, 'Correo electrónico no válido.', 'email');
  if (donor.consent !== true) throw new HttpError(400, 'Se requiere autorización para el uso de datos.', 'consent');
  const name = String(donor.name ?? '').trim().slice(0, 80);

  const t = body.target ?? {};
  if (!['general', 'campaign', 'company'].includes(t.type)) throw new HttpError(400, 'Destino no válido.', 'target');

  return {
    amount,
    method: body.method,
    donor: { email, name },
    target: { type: t.type, campaignId: t.campaignId ?? null, companyId: t.companyId ?? null },
  };
}

function verifySignature(raw, signature) {
  const expected = createHmac('sha256', webhookSecret()).update(raw).digest('hex');
  const given = String(signature ?? '');
  return given.length === expected.length && timingSafeEqual(Buffer.from(given), Buffer.from(expected));
}

// ---------- Archivos de la página ----------

async function serveStatic(req, res, pathname) {
  const rel = normalize(decodeURIComponent(pathname)).replace(/^([/\\])+/, '').replace(/\\/g, '/') || 'index.html';
  if (rel.startsWith('..') || !PUBLIC_PATHS.some((re) => re.test(rel))) {
    res.writeHead(404, { ...SECURITY_HEADERS, 'Content-Type': 'text/plain; charset=utf-8' }).end('No encontrado');
    return;
  }
  try {
    const body = await readFile(join(ROOT, rel));
    res.writeHead(200, {
      ...SECURITY_HEADERS,
      'Content-Security-Policy': CSP,
      'Content-Type': TYPES[extname(rel)] ?? 'application/octet-stream',
      'Cache-Control': rel.startsWith('assets/') && env.isProduction ? 'public, max-age=3600' : 'no-cache',
    });
    res.end(req.method === 'HEAD' ? undefined : body);
  } catch {
    res.writeHead(404, { ...SECURITY_HEADERS, 'Content-Type': 'text/plain; charset=utf-8' }).end('No encontrado');
  }
}

// ---------- API ----------

export function createApp({ db, gateway = createGateway(env.paymentsMode), demoData = env.demoData }) {
  const writeLimiter = createRateLimiter({ limit: 30, windowMs: 60_000 });
  const envelope = (data) => ({ demo: demoData, updatedAt: new Date().toISOString(), data });
  const pub = (d) => store.publicDonation(d, { sandbox: gateway.isSandbox });

  async function loadDonation(id) {
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new HttpError(404, 'Pago no encontrado.');
    const donation = await store.getDonation(db, id);
    if (!donation) throw new HttpError(404, 'Pago no encontrado.');
    return store.refreshExpiry(db, donation);
  }

  async function createPending(input, extra = {}) {
    const target = await store.resolveTarget(db, input.target);
    if (!target) throw new HttpError(400, 'La campaña o compañía elegida no está disponible.', 'target');
    return store.insertDonation(db, { ...input, target, gateway: gateway.name, ...extra });
  }

  const routes = [
    ['GET', /^\/api\/v1\/health$/, async () => [200, {
      ok: true, payments: gateway.isSandbox ? 'sandbox' : 'live', demoData, database: db.kind,
    }]],

    ['GET', /^\/api\/v1\/companies$/, async () => [200, envelope(await store.listCompanies(db))]],
    ['GET', /^\/api\/v1\/campaigns$/, async () => [200, envelope(await store.listCampaigns(db))]],
    ['GET', /^\/api\/v1\/impact$/, async () => [200, envelope(await store.getImpact(db))]],

    // Tarjeta o transferencia.
    ['POST', /^\/api\/v1\/donations$/, async ({ body }) => {
      const input = validateDonationInput(body, ['card', 'transfer']);
      const donation = await createPending(input);
      const result = input.method === 'card' ? await gateway.chargeCard(donation) : await gateway.createTransfer(donation);
      await store.setGatewayData(db, donation.id, { gatewayRef: result.gatewayRef });
      const final = result.status === 'paid' ? await store.markPaid(db, donation.id) : donation;
      return [201, pub(final ?? donation)];
    }],

    // Yape / Plin: crea el cobro y devuelve el contenido del QR.
    ['POST', /^\/api\/v1\/wallet-charges$/, async ({ body }) => {
      const input = validateDonationInput({ ...body, method: 'wallet' }, ['wallet']);
      const expiresAt = new Date(Date.now() + env.walletChargeMinutes * 60_000);
      const donation = await createPending(input, { expiresAt });
      const charge = await gateway.createWalletCharge(donation);
      return [201, pub(await store.setGatewayData(db, donation.id, charge))];
    }],

    ['GET', /^\/api\/v1\/wallet-charges\/([^/]+)$/, async ({ params: [id] }) => {
      const d = await loadDonation(id);
      return [200, { id: d.id, status: d.status }];
    }],

    // Yape con código de aprobación.
    ['POST', /^\/api\/v1\/wallet-charges\/([^/]+)\/approval-code$/, async ({ params: [id], body }) => {
      const d = await loadDonation(id);
      if (d.status !== 'pending') throw new HttpError(409, d.status === 'paid' ? 'Este pago ya fue confirmado.' : 'Este pago venció. Genera uno nuevo.');
      const phone = String(body.phone ?? '').replace(/\D/g, '');
      const code = String(body.code ?? '').replace(/\D/g, '');
      if (!/^9\d{8}$/.test(phone)) throw new HttpError(400, 'El celular debe tener 9 dígitos y empezar con 9.', 'phone');
      if (!/^\d{6}$/.test(code)) throw new HttpError(400, 'El código de aprobación tiene 6 dígitos.', 'code');
      if ((await store.incrementAttempts(db, id)) > MAX_CODE_ATTEMPTS) {
        throw new HttpError(429, 'Demasiados intentos. Genera un nuevo pago.');
      }
      const status = await gateway.approveWithCode(d, { phone, code });
      if (status === 'paid') await store.markPaid(db, id);
      return [200, { id, status: status === 'paid' ? 'paid' : 'pending' }];
    }],

    // Solo sandbox: simula el aviso de pago de la pasarela.
    ['POST', /^\/api\/v1\/wallet-charges\/([^/]+)\/simulate$/, async ({ params: [id] }) => {
      if (!gateway.isSandbox) throw new HttpError(404, 'No encontrado.');
      const d = await loadDonation(id);
      if (d.status === 'pending') await store.markPaid(db, id);
      return [200, { id, status: (await store.getDonation(db, id)).status }];
    }],

    // Aviso de la pasarela, firmado con HMAC-SHA256 en el encabezado X-Signature.
    ['POST', /^\/api\/v1\/webhooks\/payments$/, async ({ raw, req, body }) => {
      if (!verifySignature(raw, req.headers['x-signature'])) throw new HttpError(401, 'Firma inválida.');
      const { eventId, type, gatewayRef } = body;
      if (!eventId || !type || !gatewayRef) throw new HttpError(400, 'Evento incompleto.');
      if (!(await store.recordWebhookEvent(db, String(eventId), body))) return [200, { received: true, duplicate: true }];
      const d = await store.findDonationByGatewayRef(db, String(gatewayRef));
      if (!d) return [200, { received: true, matched: false }];
      if (type === 'charge.paid') await store.markPaid(db, d.id);
      if (type === 'charge.failed') await store.markFailed(db, d.id);
      return [200, { received: true }];
    }],
  ];

  return async function handle(req, res) {
    const { pathname } = new URL(req.url, 'http://localhost');
    try {
      if (!pathname.startsWith('/api/')) {
        if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'Método no permitido.');
        await serveStatic(req, res, pathname);
        return;
      }

      const route = routes.find(([method, re]) => method === req.method && re.test(pathname));
      if (!route) throw new HttpError(404, 'Ruta no encontrada.');

      let raw = '';
      let body = {};
      if (req.method === 'POST') {
        if (!writeLimiter(clientIp(req))) throw new HttpError(429, 'Demasiadas solicitudes. Espera un minuto.');
        raw = await readRawBody(req);
        body = parseJson(raw);
      }
      const params = pathname.match(route[1]).slice(1).map(decodeURIComponent);
      const [status, payload] = await route[2]({ req, raw, body, params });
      sendJson(res, status, payload);
    } catch (err) {
      if (err instanceof HttpError) {
        sendJson(res, err.status, { message: err.message, field: err.field });
      } else {
        console.error(err);
        sendJson(res, 500, { message: 'Ocurrió un error inesperado. Inténtalo nuevamente.' });
      }
    }
  };
}
