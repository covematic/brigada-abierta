// Detecta si la página corre con el backend (Web Service) o como archivos estáticos.
//   backend: true  → datos y pagos vía /api/v1
//   backend: false → datos de /data/*.json y pagos simulados en el navegador
import { config } from './config.js';

let current = { backend: false, sandbox: true, demoData: true };
let loading;

export function loadRuntime() {
  loading ??= fetch(`${config.apiBaseUrl}/health`, { headers: { Accept: 'application/json' } })
    .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
    .then((health) => ({ backend: true, sandbox: health.payments !== 'live', demoData: Boolean(health.demoData) }))
    .catch(() => ({ backend: false, sandbox: true, demoData: true }))
    .then((rt) => { current = rt; return rt; });
  return loading;
}

/** Estado ya detectado (llamar después de loadRuntime). */
export const runtime = () => current;
