// Campañas activas.
import { api } from '../api/client.js';
import { html, render, icon, errorState } from '../ui/dom.js';
import { money, number, percent, daysLeft } from '../ui/format.js';
import { observeMotion } from '../ui/motion.js';

const enc = encodeURIComponent;

function campaignCard(c, company) {
  const pct = percent(c.raised, c.goal);
  const days = daysLeft(c.endsAt);
  return html`
    <article class="card campaign reveal" aria-labelledby="cmp-${c.id}">
      <span class="badge campaign-cat">${c.category}</span>
      <h3 id="cmp-${c.id}">${c.title}</h3>
      <p class="campaign-summary">${c.summary}</p>
      ${company ? html`
        <a class="campaign-company" href="#/compania/${enc(company.id)}">
          ${icon('pin', 'icon-sm')} Compañía ${company.name} N.⁠° ${company.number} · ${company.district}
        </a>` : ''}
      ${!company && c.scope ? html`
        <p class="campaign-company">${icon('pin', 'icon-sm')} ${c.scope}</p>` : ''}
      ${c.source ? html`
        <p class="campaign-source">
          Contexto: ${c.source.url
            ? html`<a href="${c.source.url}" target="_blank" rel="noopener noreferrer">${c.source.label}</a>`
            : c.source.label}
        </p>` : ''}
      <div>
        <div class="campaign-raised">
          <strong>${money(c.raised)}</strong>
          <span>de ${money(c.goal)}</span>
        </div>
        <div class="progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}"
             aria-label="Avance de la campaña: ${pct}%">
          <span data-progress="${pct}"></span>
        </div>
        <div class="progress-meta">
          <span>${icon('users', 'icon-sm')} ${number(c.donors)} donantes</span>
          <span>${icon('calendar', 'icon-sm')} ${days === 0 ? 'Último día' : `Quedan ${days} días`}</span>
        </div>
      </div>
      <a class="btn btn-primary btn-lg btn-block" href="#/donar?campana=${enc(c.id)}">
        ${icon('heart', 'icon-sm')} Donar a esta campaña
        <span class="visually-hidden">: ${c.title}</span>
      </a>
    </article>`;
}

export async function renderCampaigns() {
  const listEl = document.getElementById('campaigns-list');
  render(listEl, html`${Array.from({ length: 3 }, () => html`<div class="campaign skeleton" aria-hidden="true"></div>`)}`);

  try {
    const [campaigns, companies] = await Promise.all([api.getCampaigns(), api.getCompanies()]);
    const byId = new Map(companies.data.map((c) => [c.id, c]));
    const active = campaigns.data.filter((c) => c.status === 'active');

    render(listEl, active.length
      ? html`${active.map((c) => campaignCard(c, byId.get(c.companyId)))}`
      : html`<p class="empty">No hay campañas activas en este momento. Puedes donar a la necesidad más urgente o directamente a una compañía.</p>`);
    observeMotion(listEl);
  } catch (err) {
    console.error(err);
    listEl.replaceChildren(errorState('No pudimos cargar las campañas.', renderCampaigns));
  }
}
