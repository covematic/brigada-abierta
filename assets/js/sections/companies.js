// Directorio de compañías (búsqueda + filtro) y diálogo de detalle.
import { api } from '../api/client.js';
import { html, render, icon, errorState } from '../ui/dom.js';
import { money, percent, listJoin, PRIORITY_LABEL } from '../ui/format.js';
import { openDialog } from '../ui/dialog.js';
import { activateNow } from '../ui/motion.js';

const enc = encodeURIComponent;
const ALL = 'Todos';
const state = { query: '', district: ALL, companies: [] };

const normalize = (s) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();

function urgency(company) {
  const high = company.needs.filter((n) => n.priority === 'high').length;
  if (high >= 2) return { label: 'Urgencia alta', cls: 'badge-high' };
  if (high === 1) return { label: 'Necesidades activas', cls: 'badge-medium' };
  return { label: 'Operativa', cls: 'badge-low' };
}

function companyCard(c) {
  const u = urgency(c);
  return html`
    <a class="card card-link company" href="#/compania/${enc(c.id)}">
      <div class="company-head">
        <span class="company-num"><small>N.°</small>${c.number}</span>
        <span class="badge ${u.cls}">${u.label}</span>
      </div>
      <div>
        <h3>Compañía ${c.name}</h3>
        <p class="company-loc">${icon('pin', 'icon-sm')} ${c.district}, ${c.department}</p>
        ${c.coverage?.length > 1 ? html`
          <p class="company-coverage">Cubre ${listJoin(c.coverage)}</p>` : ''}
      </div>
      <div class="company-foot">
        <span>${c.needs.length} necesidades</span>
        <span class="cta">Ver y donar ${icon('arrow', 'icon-sm')}</span>
      </div>
    </a>`;
}

function renderList() {
  const listEl = document.getElementById('companies-list');
  const countEl = document.getElementById('companies-count');
  const q = normalize(state.query.trim());

  const filtered = state.companies.filter((c) => {
    const inDistrict = state.district === ALL || c.district === state.district;
    const haystack = normalize(`${c.name} ${c.number} ${c.district} ${(c.coverage ?? []).join(' ')} ${c.id}`);
    return inDistrict && (!q || haystack.includes(q));
  });

  countEl.textContent = `${filtered.length} ${filtered.length === 1 ? 'compañía' : 'compañías'}`;
  render(listEl, filtered.length
    ? html`${filtered.map(companyCard)}`
    : html`<p class="empty">No encontramos compañías con ese criterio. Prueba con otro distrito o nombre.</p>`);
}

function renderFilters() {
  const el = document.getElementById('district-filters');
  const districts = [ALL, ...new Set(state.companies.map((c) => c.district))];
  render(el, html`${districts.map((d) => html`
    <button type="button" class="chip" data-district="${d}" aria-pressed="${d === state.district}">${d}</button>`)}`);
}

export async function renderCompanies() {
  const listEl = document.getElementById('companies-list');
  render(listEl, html`${Array.from({ length: 4 }, () => html`<div class="card skeleton" style="height:210px" aria-hidden="true"></div>`)}`);

  try {
    const res = await api.getCompanies();
    state.companies = res.data;
    renderFilters();
    renderList();
  } catch (err) {
    console.error(err);
    listEl.replaceChildren(errorState('No pudimos cargar el directorio.', renderCompanies));
  }
}

export function setupCompanyDirectory() {
  document.getElementById('company-search').addEventListener('input', (e) => {
    state.query = e.target.value;
    renderList();
  });
  document.getElementById('district-filters').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-district]');
    if (!btn) return;
    state.district = btn.dataset.district;
    e.currentTarget.querySelectorAll('[data-district]').forEach((b) =>
      b.setAttribute('aria-pressed', String(b === btn)));
    renderList();
  });
}

// ---------- Diálogo de detalle ----------

function needItem(n) {
  const pct = percent(n.raised, n.goal);
  return html`
    <li class="need">
      <div class="need-top">
        <span class="need-name">${n.name}</span>
        <span class="badge badge-${n.priority}">Prioridad ${PRIORITY_LABEL[n.priority].toLowerCase()}</span>
      </div>
      <p class="need-detail">${n.detail}</p>
      <div class="progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}" aria-label="Avance: ${n.name}">
        <span data-progress="${pct}"></span>
      </div>
      <div class="progress-meta">
        <span>${money(n.raised)} de ${money(n.goal)}</span>
        <strong>${pct}%</strong>
      </div>
    </li>`;
}

export async function openCompany(id) {
  const dialog = document.getElementById('company-dialog');
  const [companyRes, campaignsRes] = await Promise.all([
    api.getCompany(id),
    api.getCampaigns().catch(() => ({ data: [] })),
  ]);

  if (!companyRes) {
    render(dialog, html`
      <div class="dialog-head">
        <h2 class="dialog-title" id="company-dialog-title">Compañía no encontrada</h2>
        <button type="button" class="btn btn-icon btn-text" data-close aria-label="Cerrar">${icon('x')}</button>
      </div>
      <div class="dialog-body"><p>No existe una compañía con el código «${id}». Revisa el enlace o busca en el directorio.</p></div>`);
    openDialog(dialog);
    return;
  }

  const c = companyRes.data;
  const related = campaignsRes.data.filter((cmp) => cmp.companyId === c.id && cmp.status === 'active');
  const tel = c.phone.replace(/[^\d+]/g, '');

  render(dialog, html`
    <div class="dialog-body" style="padding:0">
      <div class="company-banner">
        <button type="button" class="btn btn-icon dialog-close-floating" data-close aria-label="Cerrar">${icon('x')}</button>
        <p class="meta">N.⁠° ${c.number} · ${c.district} · Fundada en ${c.founded}</p>
        <h2 id="company-dialog-title">Compañía ${c.name}</h2>
        <p>${c.description}</p>
        ${c.coverage?.length ? html`
          <p class="company-coverage-banner">${icon('pin', 'icon-sm')} Zona de atención: ${listJoin(c.coverage)}</p>` : ''}
        ${c.verified ? '' : html`<span class="badge badge-unverified">Datos de contacto por verificar</span>`}
      </div>

      <div class="company-cols" style="padding:24px">
        <section aria-labelledby="needs-title">
          <h3 class="block-title" id="needs-title">Lo que necesitan hoy</h3>
          <ul class="needs">${c.needs.map(needItem)}</ul>
        </section>

        <aside>
          <div class="side-box">
            <h3 class="block-title">${icon('heart', 'icon-sm')} Donación económica</h3>
            <p>Tu aporte se asigna a esta compañía con un código de trazabilidad.</p>
            <a class="btn btn-primary btn-block" style="margin-top:12px" href="#/donar?compania=${enc(c.id)}">Donar a esta compañía</a>
            ${related.length ? html`
              <p class="hint" style="margin-top:12px">Campañas activas:</p>
              ${related.map((cmp) => html`
                <a class="btn btn-text" style="padding-left:0" href="#/donar?campana=${enc(cmp.id)}">${cmp.title} ${icon('arrow', 'icon-sm')}</a>`)}` : ''}
          </div>

          <div class="side-box">
            <h3 class="block-title">${icon('pin', 'icon-sm')} Donación en especie</h3>
            <p class="hint">Coordina por teléfono antes de llevar materiales para confirmar que los necesitan.</p>
            <p class="row">${icon('pin', 'icon-sm')} <span>${c.address}</span></p>
            <p class="row">${icon('phone', 'icon-sm')} <a href="tel:${tel}">${c.phone}</a></p>
          </div>
        </aside>
      </div>
    </div>`);
  openDialog(dialog);
  activateNow(dialog);
}
