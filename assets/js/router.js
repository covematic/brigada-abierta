// Router por hash para vistas superpuestas (diálogos) con URL compartible:
//   #/compania/SBO-011
//   #/donar?campana=CMP-2026-001
//   #/donar?compania=SUR-134
// Los anclajes normales (#impacto, #campanas) no son rutas y se dejan pasar.

const routes = [];

export function route(pattern, handler) {
  routes.push({ pattern, handler });
}

function resolve(onNoRoute) {
  const hash = location.hash;
  if (!hash.startsWith('#/')) {
    onNoRoute();
    return;
  }
  const [path, query = ''] = hash.slice(1).split('?');
  const params = new URLSearchParams(query);
  for (const { pattern, handler } of routes) {
    const match = path.match(pattern);
    if (match) {
      handler({ params, match: match.slice(1).map(decodeURIComponent) });
      return;
    }
  }
  onNoRoute();
}

export function startRouter({ onNoRoute }) {
  window.addEventListener('hashchange', () => resolve(onNoRoute));
  resolve(onNoRoute);
}
