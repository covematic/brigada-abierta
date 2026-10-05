// Plantillas HTML con escape automático.
// Cualquier valor interpolado en html`` se escapa salvo que ya sea SafeHTML
// (resultado de otro html`` o de raw()). Evita XSS cuando los datos vengan de una API.

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export const escapeHTML = (value) =>
  String(value ?? '').replace(/[&<>"']/g, (ch) => ESCAPES[ch]);

class SafeHTML {
  constructor(value) { this.value = value; }
  toString() { return this.value; }
}

/** Marca un string como HTML de confianza. Úsalo solo con contenido propio. */
export const raw = (value) => new SafeHTML(String(value));

function serialize(value) {
  if (value instanceof SafeHTML) return value.value;
  if (Array.isArray(value)) return value.map(serialize).join('');
  if (value === null || value === undefined || value === false) return '';
  return escapeHTML(value);
}

export function html(strings, ...values) {
  let out = strings[0];
  values.forEach((value, i) => { out += serialize(value) + strings[i + 1]; });
  return new SafeHTML(out);
}

export function render(element, template) {
  element.innerHTML = serialize(template);
}

export const icon = (name, cls = 'icon') =>
  html`<svg class="${cls}" aria-hidden="true"><use href="#i-${name}"/></svg>`;


export function errorState(message, onRetry) {
  const el = document.createElement('div');
  el.className = 'notice notice-error';
  el.setAttribute('role', 'alert');
  render(el, html`${icon('alert')}<div>${message} <button type="button" class="btn btn-text">Reintentar</button></div>`);
  el.querySelector('button').addEventListener('click', onRetry);
  return el;
}
