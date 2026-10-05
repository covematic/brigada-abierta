// Configuración del frontend. El modo (con backend o solo archivos) se detecta
// al iniciar en runtime.js consultando /api/v1/health.
export const config = Object.freeze({
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
