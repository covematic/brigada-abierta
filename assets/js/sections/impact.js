// Métricas de impacto + transparencia (distribución y movimientos).
import { api } from '../api/client.js';
import { html, render, icon, errorState } from '../ui/dom.js';
import { formatMetric, money, date } from '../ui/format.js';
import { observeMotion } from '../ui/motion.js';

const LEDGER_STATUS = {
  executed: { label: 'Ejecutado', cls: 'badge-ok', icon: 'check' },
  assigned: { label: 'Asignado', cls: 'badge-medium', icon: 'calendar' },
};

const METRIC_ICON = {
  raised: 'heart', donors: 'users', companies: 'flame', purchases: 'receipt', equipment: 'shield', emergencies: 'alert',
};

export async function renderImpact() {
  const metricsEl = document.getElementById('impact-metrics');
  const sourceEl = document.getElementById('impact-source');
  const allocEl = document.getElementById('allocation');
  const ledgerEl = document.getElementById('ledger');

  render(metricsEl, html`${Array.from({ length: 4 }, () => html`<div class="metric skeleton" aria-hidden="true"></div>`)}`);

  try {
    const [impact, companies] = await Promise.all([api.getImpact(), api.getCompanies()]);
    const { metrics, allocation, ledger } = impact.data;
    const companyName = (id) => {
      const c = companies.data.find((x) => x.id === id);
      return c ? `${c.name} N.⁠° ${c.number}` : id;
    };

    // El valor final va en el texto (accesible y visible sin animación);
    // data-count permite animarlo al entrar en pantalla.
    render(metricsEl, html`${metrics.map((m) => html`
      <div class="card metric reveal">
        <span class="metric-icon">${icon(METRIC_ICON[m.key] ?? 'check')}</span>
        <p class="metric-value" data-count="${m.value}" data-format="${m.format}">${formatMetric(m.value, m.format)}</p>
        <p class="metric-label">${m.label}</p>
      </div>`)}`);

    render(sourceEl, impact.demo
      ? html`Cifras referenciales mientras la plataforma está en fase de prueba.`
      : html`Actualizado el ${date(impact.updatedAt)}.`);

    render(allocEl, !allocation.length
      ? html`<p class="panel-empty">Aún no hay compras ejecutadas. Aquí verás en qué se usa cada sol cuando las compañías registren sus compras.</p>`
      : html`
      <ul class="alloc">
        ${allocation.map((a) => html`
          <li>
            <div class="alloc-row"><span>${a.label}</span><strong>${a.percent}%</strong></div>
            <div class="progress" role="img" aria-label="${a.label}: ${a.percent}%"><span data-progress="${Number(a.percent)}"></span></div>
          </li>`)}
      </ul>`);

    render(ledgerEl, !ledger.length
      ? html`<p class="panel-empty">Todavía no hay movimientos registrados.</p>`
      : html`
      <ul class="ledger-list">
        ${ledger.map((row) => {
          const st = LEDGER_STATUS[row.status] ?? { label: row.status, cls: 'badge-low', icon: 'check' };
          return html`
            <li class="ledger-item">
              <div class="ledger-main">
                <p class="ledger-concept">${row.concept}</p>
                <p class="ledger-sub">${companyName(row.companyId)} · ${date(row.date)}</p>
                <p class="ledger-sub">${icon('receipt', 'icon-sm')} ${row.evidence}</p>
              </div>
              <div class="ledger-side">
                <strong>${money(row.amount)}</strong>
                <span class="badge ${st.cls}">${icon(st.icon, 'icon-sm')} ${st.label}</span>
              </div>
            </li>`;
        })}
      </ul>`);

    observeMotion(metricsEl);
    observeMotion(allocEl);
  } catch (err) {
    console.error(err);
    metricsEl.replaceChildren(errorState('No pudimos cargar las cifras.', renderImpact));
    allocEl.replaceChildren();
    ledgerEl.replaceChildren();
  }
}
