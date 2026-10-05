import { renderImpact } from './sections/impact.js';
import { renderCampaigns } from './sections/campaigns.js';
import { renderCompanies, setupCompanyDirectory, openCompany } from './sections/companies.js';
import { setupDonate, openDonate } from './sections/donate.js';
import { setupDialog, closeAllDialogs } from './ui/dialog.js';
import { observeMotion, setupScrollSpy } from './ui/motion.js';
import { route, startRouter } from './router.js';

function setupNav() {
  const toggle = document.querySelector('.nav-toggle');
  const nav = document.getElementById('site-nav');
  const setOpen = (open) => {
    nav.classList.toggle('open', open);
    toggle.setAttribute('aria-expanded', String(open));
    toggle.querySelector('.visually-hidden').textContent = open ? 'Cerrar menú' : 'Abrir menú';
    toggle.querySelector('use').setAttribute('href', open ? '#i-x' : '#i-menu');
  };
  toggle.addEventListener('click', () => setOpen(!nav.classList.contains('open')));
  nav.addEventListener('click', (e) => { if (e.target.closest('a')) setOpen(false); });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && nav.classList.contains('open')) { setOpen(false); toggle.focus(); }
  });
  // Cerrar el menú al tocar fuera de él.
  document.addEventListener('click', (e) => {
    if (nav.classList.contains('open') && !nav.contains(e.target) && !toggle.contains(e.target)) setOpen(false);
  });
  setupScrollSpy(nav);
}

// Formulario rápido del hero: el monto elegido se lleva al flujo de donación.
function setupQuickDonate() {
  const form = document.getElementById('quick-donate');
  const label = form.querySelector('[data-qd-amount]');
  form.addEventListener('change', (e) => {
    if (e.target.name === 'qd-amount') label.textContent = `S/ ${e.target.value}`;
  });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const amount = new FormData(form).get('qd-amount') ?? '';
    location.hash = `#/donar?monto=${encodeURIComponent(amount)}`;
  });
}

// Botón fijo "Donar" en celulares: aparece cuando el hero ya no se ve.
function setupMobileDonate() {
  const bar = document.querySelector('.mobile-donate');
  const hero = document.querySelector('.hero');
  if (!bar || !hero || !('IntersectionObserver' in window)) return;
  new IntersectionObserver(([entry]) => {
    bar.classList.toggle('is-visible', !entry.isIntersecting);
  }).observe(hero);
}

function showOnly(dialogId) {
  document.querySelectorAll('dialog[open]').forEach((d) => { if (d.id !== dialogId) d.close(); });
}

// Si falla la carga de datos al abrir un diálogo, avisamos en vez de no hacer nada.
function safely(fn) {
  return async (...args) => {
    try {
      await fn(...args);
    } catch (err) {
      console.error(err);
      alert('No pudimos cargar la información. Revisa tu conexión e inténtalo nuevamente.');
    }
  };
}

function init() {
  setupNav();
  setupQuickDonate();
  setupMobileDonate();
  document.querySelectorAll('dialog').forEach(setupDialog);
  setupCompanyDirectory();
  setupDonate();

  renderImpact();
  renderCampaigns();
  renderCompanies();
  observeMotion(document);

  route(/^\/compania\/([\w-]+)$/, safely(({ match: [id] }) => {
    showOnly('company-dialog');
    return openCompany(id);
  }));
  route(/^\/donar$/, safely(({ params }) => {
    showOnly('donate-dialog');
    return openDonate({
      campaignId: params.get('campana'),
      companyId: params.get('compania'),
      amount: params.get('monto'),
    });
  }));

  startRouter({ onNoRoute: closeAllDialogs });
}

init();
