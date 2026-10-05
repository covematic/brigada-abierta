// Pasarelas de pago. El resto del backend solo usa esta interfaz:
//   createWalletCharge(donation) -> { gatewayRef, qrPayload }
//   approveWithCode(donation, { phone, code }) -> 'paid' | 'failed'
//   chargeCard(donation) / createTransfer(donation) -> { gatewayRef, status }
//
// Para pasar a producción se implementa aquí un adaptador real (Culqi, Niubiz, Izipay…)
// con sus credenciales en variables de entorno, y se activa con PAYMENTS_MODE.
import { randomUUID } from 'node:crypto';
import { HttpError } from './http.js';

const sandbox = {
  name: 'sandbox',
  isSandbox: true,
  async createWalletCharge(d) {
    // Texto identificable que ninguna billetera real puede cobrar.
    return {
      gatewayRef: `sbx_${randomUUID()}`,
      qrPayload: `BRIGADA-ABIERTA|PRUEBA|${d.trace_code}|${d.currency}|${Number(d.amount).toFixed(2)}`,
    };
  },
  async approveWithCode() {
    return 'paid';
  },
  async chargeCard() {
    return { gatewayRef: `sbx_${randomUUID()}`, status: 'paid' };
  },
  async createTransfer() {
    return { gatewayRef: `sbx_${randomUUID()}`, status: 'paid' };
  },
};

const notConfigured = () => {
  throw new HttpError(501, 'La pasarela de pagos aún no está configurada. Intenta más tarde.');
};

const live = {
  name: 'live',
  isSandbox: false,
  createWalletCharge: notConfigured,
  approveWithCode: notConfigured,
  chargeCard: notConfigured,
  createTransfer: notConfigured,
};

export function createGateway(mode) {
  if (mode === 'sandbox') return sandbox;
  if (mode === 'live') return live;
  throw new Error(`PAYMENTS_MODE desconocido: ${mode}`);
}
