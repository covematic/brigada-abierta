// Abstracción de pagos.
//
// La UI solo conoce esta interfaz:
//   paymentProvider.methods
//   paymentProvider.createDonation(request)            -> tarjeta / transferencia
//   paymentProvider.createWalletCharge(request)        -> Yape / Plin: crea el cobro y devuelve el QR
//   paymentProvider.getChargeStatus(chargeId)          -> 'pending' | 'paid' | 'expired'
//   paymentProvider.payWithApprovalCode(id, {phone, code}) -> Yape con código de aprobación
//
// Flujo real previsto (ver docs/ARQUITECTURA.md):
//   1. El frontend envía la intención de donación a NUESTRO backend (sin datos de pago).
//   2. El backend crea el cobro en la pasarela (Culqi / Niubiz / Izipay / Mercado Pago).
//      Para billeteras, la pasarela devuelve el contenido del QR interoperable (EMVCo),
//      con monto y vencimiento, que Yape, Plin y las apps bancarias saben leer.
//   3. El donante paga desde su app. La pasarela avisa al backend por webhook firmado.
//   4. El navegador consulta el estado del cobro (getChargeStatus) hasta ver 'paid'.
//
// Nunca se marca una donación como pagada desde el navegador: el estado viene del backend.

import { isDemo, config } from '../config.js';

export const PAYMENT_METHODS = [
  { id: 'wallet', label: 'Yape o Plin', hint: 'Pagas desde tu celular con QR o código', icon: 'qr' },
  { id: 'card', label: 'Tarjeta de débito o crédito', hint: 'Visa, Mastercard, Amex', icon: 'card' },
  { id: 'transfer', label: 'Transferencia bancaria', hint: 'Desde la app o web de tu banco', icon: 'bank' },
];

export const WALLET_QR_MINUTES = 10;

/** Código de trazabilidad: destino + tiempo + aleatorio criptográfico. */
export function createTraceCode(targetId = 'GEN') {
  const rand = new Uint32Array(1);
  crypto.getRandomValues(rand);
  const time = Date.now().toString(36).toUpperCase();
  const tail = rand[0].toString(36).toUpperCase().padStart(6, '0').slice(-6);
  return `BA-${targetId}-${time}-${tail}`;
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- Proveedor de prueba (sin cobros reales) ----------

const testCharges = new Map();

const testProvider = {
  methods: PAYMENT_METHODS,
  isTest: true,

  async createDonation(request) {
    await wait(900);
    return {
      id: crypto.randomUUID(),
      traceCode: createTraceCode(request.target.companyId ?? 'GEN'),
      status: 'test_mode',
      createdAt: new Date(),
      ...request,
    };
  },

  async createWalletCharge(request) {
    await wait(600);
    const id = crypto.randomUUID();
    const traceCode = createTraceCode(request.target.companyId ?? 'GEN');
    // En producción este texto lo genera la pasarela (QR EMVCo con monto).
    // En prueba es un texto identificable que ninguna billetera puede cobrar.
    const qrPayload = `BRIGADA-ABIERTA|PRUEBA|${traceCode}|${config.currency}|${request.amount.toFixed(2)}`;
    const charge = {
      id, traceCode, qrPayload,
      status: 'pending',
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + WALLET_QR_MINUTES * 60_000),
      request,
    };
    testCharges.set(id, charge);
    return charge;
  },

  async getChargeStatus(id) {
    const charge = testCharges.get(id);
    if (!charge) throw new Error('Cobro no encontrado.');
    if (charge.status === 'pending' && Date.now() > charge.expiresAt.getTime()) charge.status = 'expired';
    return charge.status;
  },

  async payWithApprovalCode(id, { phone, code }) {
    await wait(1200);
    const charge = testCharges.get(id);
    if (!charge) throw new Error('Cobro no encontrado.');
    if (!/^9\d{8}$/.test(phone)) throw new Error('El celular debe tener 9 dígitos y empezar con 9.');
    if (!/^\d{6}$/.test(code)) throw new Error('El código de aprobación tiene 6 dígitos.');
    charge.status = 'paid';
    return charge.status;
  },

  /** Solo en prueba: simula que la pasarela confirmó el pago por QR. */
  async simulateWalletPayment(id) {
    await wait(700);
    const charge = testCharges.get(id);
    if (charge) charge.status = 'paid';
  },
};

// ---------- Proveedor real (pendiente de backend) ----------

async function apiCall(path, options = {}) {
  const res = await fetch(`${config.apiBaseUrl}${path}`, {
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    ...options,
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message ?? 'No pudimos procesar el pago.');
  return res.json();
}

const liveProvider = {
  methods: PAYMENT_METHODS,
  isTest: false,
  createDonation: (request) => apiCall('/donations', { method: 'POST', body: JSON.stringify(request) }),
  async createWalletCharge(request) {
    const charge = await apiCall('/wallet-charges', { method: 'POST', body: JSON.stringify(request) });
    return { ...charge, createdAt: new Date(charge.createdAt), expiresAt: new Date(charge.expiresAt) };
  },
  getChargeStatus: async (id) => (await apiCall(`/wallet-charges/${encodeURIComponent(id)}`)).status,
  payWithApprovalCode: async (id, body) =>
    (await apiCall(`/wallet-charges/${encodeURIComponent(id)}/approval-code`, { method: 'POST', body: JSON.stringify(body) })).status,
};

export const paymentProvider = isDemo ? testProvider : liveProvider;

export const STATUS_LABEL = {
  test_mode: 'Registrada en fase de prueba (sin cobro)',
  paid: 'Pagada',
  pending: 'Esperando confirmación',
  assigned: 'Asignada a la compañía',
  executed: 'Ejecutada con evidencia',
};
