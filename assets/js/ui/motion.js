// Movimiento sutil: aparición al hacer scroll, contadores y barras de progreso.
// Todo respeta "reducir movimiento" del sistema y el contenido es visible sin JS
// (las clases que ocultan solo aplican cuando <html> tiene .js-motion).

import { money, number } from './format.js';

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

if (!reduceMotion.matches && 'IntersectionObserver' in window) {
  document.documentElement.classList.add('js-motion');
}

function countUp(el) {
  const target = Number(el.dataset.count);
  const format = el.dataset.format === 'currency' ? money : number;
  if (reduceMotion.matches || !Number.isFinite(target)) {
    el.textContent = format(target);
    return;
  }
  const duration = 1200;
  const start = performance.now();
  const tick = (now) => {
    const t = Math.min(1, (now - start) / duration);
    const eased = 1 - (1 - t) ** 3;
    el.textContent = format(Math.round(target * eased));
    if (t < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

function activate(el) {
  if (el.classList.contains('reveal')) el.classList.add('is-visible');
  el.querySelectorAll?.('[data-progress]').forEach((bar) => { bar.style.width = `${bar.dataset.progress}%`; });
  if (el.dataset?.progress) el.style.width = `${el.dataset.progress}%`;
  el.querySelectorAll?.('[data-count]').forEach(countUp);
  if (el.dataset?.count) countUp(el);
}

const observer = 'IntersectionObserver' in window
  ? new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          activate(entry.target);
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.15, rootMargin: '0px 0px -40px 0px' })
  : null;

/** Observa los elementos animables dentro de `root`. */
export function observeMotion(root = document) {
  const targets = root.querySelectorAll('.reveal, [data-progress], [data-count]');
  targets.forEach((el) => {
    // Contadores y barras dentro de un .reveal se activan con su contenedor.
    if (!el.classList.contains('reveal') && el.closest('.reveal')) return;
    if (observer && !reduceMotion.matches) observer.observe(el);
    else activate(el);
  });
}

/** Activa de inmediato (para contenido dentro de diálogos ya visibles). */
export function activateNow(root) {
  // Dos frames: deja que el navegador pinte el estado inicial (ancho 0) para que la barra se anime.
  requestAnimationFrame(() => requestAnimationFrame(() => {
    root.querySelectorAll('.reveal, [data-progress], [data-count]').forEach(activate);
  }));
}

/** Resalta en el menú la sección visible. */
export function setupScrollSpy(nav) {
  if (!('IntersectionObserver' in window)) return;
  const links = new Map(
    [...nav.querySelectorAll('a[href^="#"]')].map((a) => [a.getAttribute('href').slice(1), a]),
  );
  const spy = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      const link = links.get(entry.target.id);
      if (!link || !entry.isIntersecting) return;
      links.forEach((a) => a.removeAttribute('aria-current'));
      link.setAttribute('aria-current', 'true');
    });
  }, { rootMargin: '-45% 0px -50% 0px' });
  links.forEach((_, id) => {
    const section = document.getElementById(id);
    if (section) spy.observe(section);
  });
}
