// Configuración del backend, toda desde variables de entorno.
import { fileURLToPath } from 'node:url';

const bool = (value, fallback) => (value === undefined ? fallback : value === 'true');

export const env = Object.freeze({
  port: Number(process.env.PORT) || 5173,
  isProduction: process.env.NODE_ENV === 'production',

  // Sin DATABASE_URL se usa PGlite (Postgres embebido) en .data/pglite: ideal para desarrollo.
  databaseUrl: process.env.DATABASE_URL || '',
  databaseSsl: bool(process.env.DATABASE_SSL, false),
  localDbDir: process.env.PGLITE_DIR || fileURLToPath(new URL('../.data/pglite', import.meta.url)),

  // 'sandbox' = flujo completo sin dinero real. 'live' = pasarela real (pendiente de integrar).
  paymentsMode: process.env.PAYMENTS_MODE || 'sandbox',
  webhookSecret: process.env.PAYMENT_WEBHOOK_SECRET || '',

  // true = carga cifras referenciales de /data al crear la base y lo indica en las respuestas.
  demoData: bool(process.env.DEMO_DATA, true),

  walletChargeMinutes: Number(process.env.WALLET_CHARGE_MINUTES) || 10,
});

export function assertProductionConfig() {
  if (!env.isProduction) return;
  const missing = [];
  if (!env.databaseUrl) missing.push('DATABASE_URL');
  if (!env.webhookSecret) missing.push('PAYMENT_WEBHOOK_SECRET');
  if (missing.length) throw new Error(`Faltan variables de entorno en producción: ${missing.join(', ')}`);
}

/** Secreto efectivo: en desarrollo se usa uno fijo para poder probar webhooks. */
export const webhookSecret = () => env.webhookSecret || 'secreto-de-desarrollo';
