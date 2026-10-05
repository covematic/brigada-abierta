// Pagos desde el navegador. La UI solo usa `paymentProvider`:
//   methods · isTest
//   createDonation(request)                     -> tarjeta / transferencia
//   createWalletCharge(request)                 -> Yape / Plin: { id, traceCode, qrPayload, expiresAt }
//   getChargeStatus(id)                         -> 'pending' | 'paid' | 'expired' | 'failed'
//   payWithApprovalCode(id, { phone, code })    -> Yape con código de aprobación
//   simulateWalletPayment(id)                   -> solo en prueba
//
// Con backend (runtime().backend) todo pasa por /api/v1: el servidor habla con la
// pasarela y el estado "pagado" solo lo escribe el backend (webhook firmado).
// Sin backend (sitio estático) se usa una simulación local, sin cobros.
import { config } from '../config.js';

export const PAYMENT_METHODS = [
  { id: 'wallet', label: 'Yape o Plin', hint: 'Pagas desde tu celular con QR o código', icon: 'qr' },
  { id: 'card', label: 'Tarjeta de débito o crédito', hint: 'Visa, Mastercard, Amex', icon: 'card' },
  { id: 'transfer', label: 'Transferencia bancaria', hint: 'Desde la app o web de tu banco', icon: 'bank' },
];

export const WALLET_QR_MINUTES = 10;

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function createTraceCode(targetId = 'GEN') {
  const rand = new Uint32Array(1);
  crypto.getRandomValues(rand);
  const time = Date.now().toString(36).toUpperCase();
  const tail = rand[0].toString(36).toUpperCase().padStart(6, '0').slice(-6);
  return `BA-${targetId}-${time}-${tail}`;
}

// ---------- Con backend ----------

async function apiCall(path, body) {
  const res = await fetch(`${config.apiBaseUrl}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.message ?? 'No pudimos procesar el pago. Inténtalo nuevamente.');
    err.field = data.field;
    throw err;
  }
  return data;
}

const withDates = (r) => ({
  ...r,
  createdAt: new Date(r.createdAt),
  expiresAt: r.expiresAt ? new Date(r.expiresAt) : null,
});

function backendProvider({ sandbox }) {
  return {
    methods: PAYMENT_METHODS,
    isTest: sandbox,
    async createDonation(request) {
      const res = withDates(await apiCall('/donations', request));
      return { ...request, ...res, status: res.sandbox ? 'test_mode' : res.status };
    },
    createWalletCharge: async (request) => withDates(await apiCall('/wallet-charges', request)),
    getChargeStatus: async (id) => (await apiCall(`/wallet-charges/${encodeURIComponent(id)}`)).status,
    payWithApprovalCode: async (id, body) =>
      (await apiCall(`/wallet-charges/${encodeURIComponent(id)}/approval-code`, body)).status,
    simulateWalletPayment: (id) => apiCall(`/wallet-charges/${encodeURIComponent(id)}/simulate`, {}),
  };
}

// ---------- Sin backend: simulación local ----------

const localCharges = new Map();

const localProvider = {
  methods: PAYMENT_METHODS,
  isTest: true,
  async createDonation(request) {
    await wait(900);
    return { ...request, id: crypto.randomUUID(), traceCode: createTraceCode(request.target.companyId ?? 'GEN'), status: 'test_mode', createdAt: new Date() };
  },
  async createWalletCharge(request) {
    await wait(600);
    const id = crypto.randomUUID();
    const traceCode = createTraceCode(request.target.companyId ?? 'GEN');
    const charge = {
      id, traceCode,
      qrPayload: `BRIGADA-ABIERTA|PRUEBA|${traceCode}|${config.currency}|${request.amount.toFixed(2)}`,
      status: 'pending',
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + WALLET_QR_MINUTES * 60_000),
    };
    localCharges.set(id, charge);
    return charge;
  },
  async getChargeStatus(id) {
    const charge = localCharges.get(id);
    if (!charge) throw new Error('Pago no encontrado.');
    if (charge.status === 'pending' && Date.now() > charge.expiresAt.getTime()) charge.status = 'expired';
    return charge.status;
  },
  async payWithApprovalCode(id, { phone, code }) {
    await wait(1200);
    const charge = localCharges.get(id);
    if (!charge) throw new Error('Pago no encontrado.');
    if (!/^9\d{8}$/.test(phone)) throw new Error('El celular debe tener 9 dígitos y empezar con 9.');
    if (!/^\d{6}$/.test(code)) throw new Error('El código de aprobación tiene 6 dígitos.');
    charge.status = 'paid';
    return charge.status;
  },
  async simulateWalletPayment(id) {
    await wait(700);
    const charge = localCharges.get(id);
    if (charge) charge.status = 'paid';
  },
};

// ---------- Selección según el entorno ----------

let impl = localProvider;

/** Se llama al iniciar, con el resultado de loadRuntime(). */
export function selectPaymentProvider(rt) {
  impl = rt.backend ? backendProvider(rt) : localProvider;
}

export const paymentProvider = {
  get methods() { return impl.methods; },
  get isTest() { return impl.isTest; },
  createDonation: (...args) => impl.createDonation(...args),
  createWalletCharge: (...args) => impl.createWalletCharge(...args),
  getChargeStatus: (...args) => impl.getChargeStatus(...args),
  payWithApprovalCode: (...args) => impl.payWithApprovalCode(...args),
  simulateWalletPayment: (...args) => impl.simulateWalletPayment(...args),
};

export const STATUS_LABEL = {
  test_mode: 'Registrada en fase de prueba (sin cobro)',
  paid: 'Pagada',
  pending: 'Esperando confirmación',
  assigned: 'Asignada a la compañía',
  executed: 'Ejecutada con evidencia',
};
