// Capa de acceso a datos. Toda la UI pide datos SOLO a través de este módulo.
// Con backend usa /api/v1; sin backend, los archivos de /data (ver runtime.js).
//
// Contrato de respuesta (igual en ambos casos):
//   { demo: boolean, updatedAt: string, data: ... }
import { config } from '../config.js';
import { runtime } from '../runtime.js';

const cache = new Map();

async function request(resource) {
  if (cache.has(resource)) return cache.get(resource);

  const url = runtime().backend
    ? `${config.apiBaseUrl}/${resource}`
    : `${config.demoDataUrl}/${resource}.json`;

  const promise = fetch(url, { headers: { Accept: 'application/json' } })
    .then((res) => {
      if (!res.ok) throw new Error(`Error ${res.status} al cargar ${resource}`);
      return res.json();
    })
    .catch((err) => {
      cache.delete(resource); // permitir reintento
      throw err;
    });

  cache.set(resource, promise);
  return promise;
}

export const api = {
  getImpact: () => request('impact'),
  getCampaigns: () => request('campaigns'),
  getCompanies: () => request('companies'),

  async getCompany(id) {
    const { data, ...meta } = await request('companies');
    const company = data.find((c) => c.id === id);
    return company ? { ...meta, data: company } : null;
  },

  /** Olvida los datos guardados (p. ej. tras una donación) para volver a pedirlos. */
  refresh() {
    cache.clear();
  },
};
