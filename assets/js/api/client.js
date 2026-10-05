// Capa de acceso a datos. Toda la UI pide datos SOLO a través de este módulo,
// así pasar de JSON de demostración a un backend real es cambiar `config.mode`.
//
// Contrato de respuesta (igual en demo y en producción):
//   { demo: boolean, updatedAt: string, data: ... }
import { config, isDemo } from '../config.js';

const cache = new Map();

async function request(resource) {
  if (cache.has(resource)) return cache.get(resource);

  const url = isDemo
    ? `${config.demoDataUrl}/${resource}.json`
    : `${config.apiBaseUrl}/${resource}`;

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

  async getCampaign(id) {
    const { data, ...meta } = await request('campaigns');
    const campaign = data.find((c) => c.id === id);
    return campaign ? { ...meta, data: campaign } : null;
  },
};
