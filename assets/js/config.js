// Configuración central. En producción estos valores vendrían de variables
// de entorno inyectadas en el build (p. ej. import.meta.env en Vite).
export const config = Object.freeze({
  // 'demo' lee /data/*.json y simula pagos. 'live' usa API_BASE_URL.
  mode: 'demo',
  apiBaseUrl: '/api/v1',
  demoDataUrl: 'data',
  currency: 'PEN',
  locale: 'es-PE',
  donation: {
    presets: [20, 50, 100, 250],
    defaultAmount: 50,
    min: 5,
    max: 20000,
  },
});

export const isDemo = config.mode === 'demo';
