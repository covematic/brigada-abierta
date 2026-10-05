// Flujo de donación: 1) Monto → 2) Tus datos y método → [3) Pago con Yape/Plin] → Constancia.
// Pensado para cualquier edad: botones grandes, una decisión por bloque,
// el monto siempre visible y el botón "atrás" del celular retrocede un paso.
import { api } from '../api/client.js';
import { config, isDemo } from '../config.js';
import { html, raw, render, icon } from '../ui/dom.js';
import { money, moneyExact, dateTime } from '../ui/format.js';
import { openDialog } from '../ui/dialog.js';
import { drawQR, downloadCanvas } from '../ui/qr.js';
import { paymentProvider, STATUS_LABEL, WALLET_QR_MINUTES } from '../payments/provider.js';

const { presets, defaultAmount, min, max } = config.donation;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const fmt = (n) => (Number.isInteger(n) ? money(n) : moneyExact(n));
const STEP = { AMOUNT: 0, DETAILS: 1, WALLET: 2, DONE: 3 };
const POLL_MS = 3000;

let dialog;
let catalog = { campaigns: [], companies: [] };
let state;

// Historial: cada paso agrega una entrada para que "atrás" retroceda un paso.
let historyDepth = 0;
let unwinding = false;

// Billetera: temporizadores activos.
let walletTimers = [];

const isTouchDevice = () =>
  window.matchMedia('(pointer: coarse)').matches || window.innerWidth < 720;

function initialState(targetKey, amount) {
  return {
    step: STEP.AMOUNT,
    targetKey,
    amount,
    showTargets: false,
    donor: { name: '', email: '', consent: false },
    method: 'wallet',
    result: null,
    submitting: false,
    errors: {},
    submitError: '',
    wallet: null,
  };
}

function initialWallet() {
  return {
    mode: isTouchDevice() ? 'code' : 'qr',
    charge: null,
    status: 'creating', // creating | pending | expired | error
    error: '',
    notice: '',
    phone: '',
    code: '',
    paying: false,
    checking: false,
  };
}

// ---------- Destino ----------

function describeTarget(key) {
  const [type, id] = key.split(':');
  if (type === 'campaign') {
    const cmp = catalog.campaigns.find((c) => c.id === id);
    const co = cmp && catalog.companies.find((c) => c.id === cmp.companyId);
    if (cmp) {
      return {
        type, campaignId: cmp.id, companyId: cmp.companyId,
        label: cmp.title,
        detail: co ? `Compañía ${co.name} N.⁠° ${co.number} · ${co.district}` : '',
      };
    }
  }
  if (type === 'company') {
    const co = catalog.companies.find((c) => c.id === id);
    if (co) return { type, companyId: co.id, label: `Compañía ${co.name} N.⁠° ${co.number}`, detail: co.district };
  }
  return { type: 'general', companyId: null, label: 'Donde más se necesite', detail: 'Se asigna a la necesidad más urgente de las compañías' };
}

function targetOptions() {
  const option = (key, title, sub) => html`
    <label class="option option-row">
      <input type="radio" name="target" value="${key}" ${state.targetKey === key ? 'checked' : ''}>
      <span class="option-box"><span>${title}<br><small>${sub}</small></span></span>
    </label>`;
  return html`
    <fieldset class="target-list" id="target-list">
      <legend class="visually-hidden">Elige a quién donar</legend>
      ${option('general', 'Donde más se necesite', 'Nosotros lo asignamos a la necesidad más urgente')}
      <p class="target-group">Campañas</p>
      ${catalog.campaigns.filter((c) => c.status === 'active').map((c) => {
        const co = catalog.companies.find((x) => x.id === c.companyId);
        return option(`campaign:${c.id}`, c.title, co ? `Compañía ${co.name} · ${co.district}` : '');
      })}
      <p class="target-group">Compañías</p>
      ${catalog.companies.map((c) => option(`company:${c.id}`, `Compañía ${c.name} N.⁠° ${c.number}`, c.district))}
    </fieldset>`;
}

function requestPayload() {
  const target = describeTarget(state.targetKey);
  return {
    amount: state.amount,
    currency: config.currency,
    frequency: 'once',
    method: state.method,
    target: { type: target.type, campaignId: target.campaignId ?? null, companyId: target.companyId },
    donor: { ...state.donor, anonymous: !state.donor.name },
  };
}

// ---------- Vistas ----------

const fieldError = (key) => html`<p class="error-msg" id="err-${key}" role="alert">${state.errors[key] ?? ''}</p>`;
const invalid = (key) => (state.errors[key] ? 'true' : 'false');

function stepAmount() {
  const target = describeTarget(state.targetKey);
  const isPreset = presets.includes(state.amount);
  return html`
    <h3 class="step-title" tabindex="-1">¿Cuánto quieres donar?</h3>

    <fieldset class="donate-block">
      <legend class="visually-hidden">Monto</legend>
      <div class="options options-amounts">
        ${presets.map((p) => html`
          <label class="option">
            <input type="radio" name="preset" value="${p}" ${state.amount === p ? 'checked' : ''}>
            <span class="option-box option-amount">${money(p)}</span>
          </label>`)}
      </div>
      <div class="field custom-amount">
        <label class="label" for="d-custom">Otro monto</label>
        <div class="input-prefix">
          <span aria-hidden="true">S/</span>
          <input class="input input-lg" id="d-custom" name="custom" type="text" inputmode="decimal" autocomplete="off"
                 placeholder="Escribe el monto" value="${isPreset || !Number.isFinite(state.amount) ? '' : state.amount}"
                 aria-invalid="${invalid('amount')}" aria-describedby="amount-hint err-amount">
        </div>
        <p class="hint" id="amount-hint">Desde ${money(min)} hasta ${money(max)}.</p>
        ${fieldError('amount')}
      </div>
    </fieldset>

    <div class="donate-block">
      <p class="label">Tu donación va para</p>
      <div class="target-card">
        <span class="target-icon">${icon('flame')}</span>
        <div class="target-text"><strong>${target.label}</strong><span>${target.detail}</span></div>
        <button type="button" class="btn btn-small" data-action="toggle-targets"
                aria-expanded="${state.showTargets}" aria-controls="target-list">
          ${state.showTargets ? 'Cerrar' : 'Cambiar'}
        </button>
      </div>
      ${state.showTargets ? targetOptions() : ''}
    </div>`;
}

function recap() {
  const target = describeTarget(state.targetKey);
  return html`
    <div class="recap">
      <div>
        <span class="recap-label">Vas a donar</span>
        <strong class="recap-amount">${fmt(state.amount)}</strong>
        <span class="recap-target">para ${target.label}</span>
      </div>
      ${state.step === STEP.DETAILS ? html`<button type="button" class="btn btn-small" data-action="back">Cambiar</button>` : ''}
    </div>`;
}

function stepDetails() {
  const d = state.donor;
  return html`
    ${recap()}

    <h3 class="step-title" tabindex="-1">Tus datos</h3>
    <div class="field">
      <label class="label" for="d-email">Tu correo electrónico</label>
      <input class="input input-lg" id="d-email" name="email" type="email" autocomplete="email" inputmode="email" required
             value="${d.email}" aria-invalid="${invalid('email')}" aria-describedby="email-hint err-email">
      <p class="hint" id="email-hint">Aquí te enviaremos tu constancia.</p>
      ${fieldError('email')}
    </div>
    <div class="field">
      <label class="label" for="d-name">Tu nombre <span class="optional">(opcional)</span></label>
      <input class="input input-lg" id="d-name" name="name" type="text" autocomplete="name" maxlength="80"
             value="${d.name}" aria-describedby="name-hint">
      <p class="hint" id="name-hint">Si lo dejas vacío, tu donación será anónima.</p>
    </div>

    <fieldset class="donate-block">
      <legend class="step-title">¿Cómo quieres pagar?</legend>
      <div class="options">
        ${paymentProvider.methods.map((m) => html`
          <label class="option option-row">
            <input type="radio" name="method" value="${m.id}" ${state.method === m.id ? 'checked' : ''}>
            <span class="option-box"><span class="method-icon">${icon(m.icon)}</span><span>${m.label}<br><small>${m.hint}</small></span></span>
          </label>`)}
      </div>
    </fieldset>

    <div class="field donate-block">
      <label class="check">
        <input type="checkbox" name="consent" required ${d.consent ? 'checked' : ''}
               aria-invalid="${invalid('consent')}" aria-describedby="err-consent">
        <span>Acepto que usen mis datos solo para esta donación y para enviarme la constancia
          (Ley N.° 29733 de Protección de Datos Personales).</span>
      </label>
      ${fieldError('consent')}
    </div>

    <p class="secure-note">${icon('lock', 'icon-sm')} Pago seguro: nunca vemos ni guardamos los datos de tu tarjeta.</p>
    ${isDemo ? html`<p class="test-note">${icon('alert', 'icon-sm')} La plataforma está en fase de prueba: todavía no se realizan cobros reales.</p>` : ''}
    ${state.submitError ? html`<div class="notice notice-error" role="alert">${icon('alert')}<span>${state.submitError}</span></div>` : ''}`;
}

// ---------- Paso Yape / Plin ----------

function walletTabs() {
  const w = state.wallet;
  const tab = (mode, label, sub) => html`
    <button type="button" class="seg-btn" data-action="wallet-mode" data-mode="${mode}" aria-pressed="${w.mode === mode}">
      <strong>${label}</strong><small>${sub}</small>
    </button>`;
  return html`
    <div class="segmented" role="group" aria-label="Forma de pagar con billetera">
      ${tab('qr', 'Escanear QR', 'Yape, Plin y bancos')}
      ${tab('code', 'Código Yape', 'Sin escanear nada')}
    </div>`;
}

function walletQR() {
  const w = state.wallet;
  const touch = isTouchDevice();
  if (w.status === 'error') return '';
  if (w.status === 'creating') {
    return html`<div class="qr-stage"><div class="qr-frame qr-loading"><span class="spinner spinner-dark" aria-hidden="true"></span></div><p class="hint">Generando tu código QR…</p></div>`;
  }
  if (w.status === 'expired') {
    return html`
      <div class="qr-stage">
        <div class="qr-frame qr-expired">
          ${icon('alert')}
          <strong>Este código QR venció</strong>
          <span>Por seguridad, cada código dura ${WALLET_QR_MINUTES} minutos.</span>
          <button type="button" class="btn btn-primary" data-action="wallet-renew">Generar un código nuevo</button>
        </div>
      </div>`;
  }
  return html`
    <div class="qr-stage">
      <div class="qr-frame">
        <canvas id="wallet-qr" role="img" aria-label="Código QR para pagar ${fmt(state.amount)} con Yape o Plin"></canvas>
        <span class="qr-corner qr-corner-tl" aria-hidden="true"></span>
        <span class="qr-corner qr-corner-br" aria-hidden="true"></span>
      </div>
      <p class="qr-amount">${fmt(state.amount)}</p>
      <p class="qr-timer">${icon('calendar', 'icon-sm')} Vence en <strong data-wallet-timer>${remainingText()}</strong></p>
    </div>

    <ol class="howto">
      <li><span class="howto-n">1</span><span>Abre <strong>Yape</strong>, <strong>Plin</strong> o la app de tu banco.</span></li>
      <li><span class="howto-n">2</span><span>Toca <strong>“Escanear QR”</strong> y apunta la cámara a este código.</span></li>
      <li><span class="howto-n">3</span><span>Verifica que diga <strong>${fmt(state.amount)}</strong> y confirma el pago.</span></li>
    </ol>

    ${touch ? html`
      <div class="same-phone">
        <p><strong>¿Estás viendo esto en el mismo celular con el que vas a pagar?</strong></p>
        <p class="hint">Guarda el QR en tu galería. En Yape o Plin toca “Escanear” y luego el ícono de imagen para elegirlo.</p>
        <button type="button" class="btn btn-block" data-action="wallet-save">${icon('receipt', 'icon-sm')} Guardar QR en mi galería</button>
        <button type="button" class="btn btn-text btn-block" data-action="wallet-mode" data-mode="code">O paga con tu código de aprobación de Yape</button>
      </div>` : ''}

    <p class="wait-status" role="status">
      <span class="pulse" aria-hidden="true"></span>
      ${w.notice || 'Esperando tu pago. Esta pantalla se actualizará sola cuando lo recibamos.'}
    </p>
    ${paymentProvider.isTest ? html`
      <div class="test-box">
        <p class="test-note">${icon('alert', 'icon-sm')} Fase de prueba: este QR todavía no se puede pagar desde una billetera real.</p>
        <button type="button" class="btn btn-small" data-action="wallet-simulate">Simular pago recibido</button>
      </div>` : ''}`;
}

function walletCode() {
  const w = state.wallet;
  return html`
    <p class="code-intro">Paga sin escanear nada: Yape te da un código de 6 dígitos para aprobar compras.</p>
    <ol class="howto">
      <li><span class="howto-n">1</span><span>Abre <strong>Yape</strong> en tu celular.</span></li>
      <li><span class="howto-n">2</span><span>Toca el menú y entra a <strong>“Código de aprobación”</strong>.</span></li>
      <li><span class="howto-n">3</span><span>Escribe aquí tu celular y ese código. Tienes unos minutos antes de que cambie.</span></li>
    </ol>
    <div class="field">
      <label class="label" for="w-phone">Celular registrado en Yape</label>
      <input class="input input-lg input-digits" id="w-phone" name="phone" type="tel" inputmode="numeric"
             autocomplete="tel-national" maxlength="9" placeholder="9XX XXX XXX" value="${w.phone}"
             aria-invalid="${invalid('phone')}" aria-describedby="err-phone">
      ${fieldError('phone')}
    </div>
    <div class="field">
      <label class="label" for="w-code">Código de aprobación</label>
      <input class="input input-lg input-digits input-code" id="w-code" name="code" type="text" inputmode="numeric"
             autocomplete="one-time-code" maxlength="6" placeholder="••••••" value="${w.code}"
             aria-invalid="${invalid('code')}" aria-describedby="err-code">
      ${fieldError('code')}
    </div>
    ${paymentProvider.isTest ? html`<p class="test-note">${icon('alert', 'icon-sm')} Fase de prueba: escribe cualquier celular que empiece con 9 y un código de 6 dígitos. No se cobrará nada.</p>` : ''}`;
}

function stepWallet() {
  const w = state.wallet;
  return html`
    <h3 class="step-title" tabindex="-1">Paga con Yape o Plin</h3>
    <p class="wallet-for">Donación para <strong>${describeTarget(state.targetKey).label}</strong></p>
    ${walletTabs()}
    <div class="wallet-panel" data-mode="${w.mode}">
      ${w.mode === 'qr' ? walletQR() : walletCode()}
    </div>
    ${w.error ? html`<div class="notice notice-error" role="alert">${icon('alert')}<span>${w.error}</span></div>` : ''}
    ${w.status === 'error' ? html`<button type="button" class="btn btn-block wallet-retry" data-action="wallet-renew">Intentar de nuevo</button>` : ''}`;
}

function stepDone() {
  const r = state.result;
  const target = describeTarget(state.targetKey);
  const method = paymentProvider.methods.find((m) => m.id === r.method);
  return html`
    <div class="success-head">
      <div class="success-icon">${icon('check')}</div>
      <h3 class="step-title" tabindex="-1">¡Gracias por tu apoyo!</h3>
      <p>Tu aporte de <strong>${fmt(r.amount)}</strong> quedó registrado para <strong>${target.label}</strong>.</p>
    </div>
    <ul class="summary">
      <li><span>Código de tu donación</span><span class="mono">${r.traceCode}</span></li>
      <li><span>Destino</span><span>${target.label}</span></li>
      <li><span>Donante</span><span>${state.donor.name || 'Anónimo'}</span></li>
      <li><span>Método</span><span>${method?.label ?? r.method}</span></li>
      <li><span>Fecha</span><span>${dateTime(r.createdAt)}</span></li>
      <li><span>Estado</span><span>${STATUS_LABEL[r.status] ?? r.status}</span></li>
      <li class="total"><span>Total</span><span>${moneyExact(r.amount)}</span></li>
    </ul>
    <p class="secure-note">${icon('receipt', 'icon-sm')}
      ${isDemo
        ? 'Guarda este código. Cuando la plataforma esté activa, también te llegará por correo.'
        : html`Enviamos esta constancia a <strong>${state.donor.email}</strong>.`}
    </p>`;
}

const STEP_VIEWS = { [STEP.AMOUNT]: stepAmount, [STEP.DETAILS]: stepDetails, [STEP.WALLET]: stepWallet, [STEP.DONE]: stepDone };

function footer() {
  const { step, submitting } = state;
  if (step === STEP.DONE) {
    return html`
      <div class="dialog-foot no-print">
        <button type="button" class="btn" data-action="print">${icon('print', 'icon-sm')} Imprimir</button>
        <button type="button" class="btn btn-primary btn-grow" data-close>Listo</button>
      </div>`;
  }

  if (step === STEP.WALLET) {
    const w = state.wallet;
    const busy = w.paying || w.checking;
    const primary = w.mode === 'code'
      ? html`<button type="submit" form="donate-form" class="btn btn-primary btn-lg btn-grow" ${w.paying ? raw('disabled aria-busy="true"') : ''}>
          ${w.paying ? html`<span class="spinner" aria-hidden="true"></span> Confirmando…` : html`${icon('lock', 'icon-sm')} Pagar ${fmt(state.amount)}`}
        </button>`
      : html`<button type="button" class="btn btn-dark btn-lg btn-grow" data-action="wallet-check" ${w.status !== 'pending' || busy ? 'disabled' : ''}>
          ${w.checking ? html`<span class="spinner" aria-hidden="true"></span> Verificando…` : 'Ya pagué, verificar'}
        </button>`;
    return html`
      <div class="dialog-foot">
        <button type="button" class="btn" data-action="back" ${busy ? 'disabled' : ''}>Atrás</button>
        ${primary}
      </div>`;
  }

  const walletNext = step === STEP.DETAILS && state.method === 'wallet';
  const label = step === STEP.AMOUNT
    ? html`Continuar con <span data-amount-label>${Number.isFinite(state.amount) ? fmt(state.amount) : ''}</span>`
    : (submitting ? 'Procesando…' : walletNext ? 'Ir a pagar con Yape o Plin' : `Donar ${fmt(state.amount)}`);
  return html`
    <div class="dialog-foot">
      ${step === STEP.DETAILS
        ? html`<button type="button" class="btn" data-action="back" ${submitting ? 'disabled' : ''}>Atrás</button>`
        : html`<button type="button" class="btn btn-text" data-close>Cancelar</button>`}
      <button type="submit" form="donate-form" class="btn btn-primary btn-lg btn-grow" ${submitting ? raw('disabled aria-busy="true"') : ''}>
        ${submitting ? html`<span class="spinner" aria-hidden="true"></span>` : ''}
        ${step === STEP.DETAILS && !submitting && !walletNext ? icon('heart', 'icon-sm') : ''}
        ${label}
        ${step === STEP.AMOUNT || walletNext ? icon('arrow', 'icon-sm') : ''}
      </button>
    </div>`;
}

function progressInfo() {
  // Con Yape/Plin hay un paso más.
  const total = state.method === 'wallet' ? 3 : 2;
  const current = state.step === STEP.WALLET ? 3 : state.step + 1;
  return { total, current };
}

function view() {
  const { total, current } = progressInfo();
  const done = state.step === STEP.DONE;
  return html`
    <div class="dialog-head no-print">
      <div>
        <h2 class="dialog-title" id="donate-dialog-title">${done ? 'Constancia de donación' : 'Haz tu donación'}</h2>
        ${done ? '' : html`<p class="dialog-sub">Paso ${current} de ${total}</p>`}
      </div>
      <button type="button" class="btn btn-icon btn-text" data-close aria-label="Cerrar">${icon('x')}</button>
    </div>
    ${done ? '' : html`
      <div class="step-bar no-print" aria-hidden="true"><span style="width:${Math.round((current / total) * 100)}%"></span></div>`}
    <form class="dialog-body step-anim" id="donate-form" novalidate>
      ${STEP_VIEWS[state.step]()}
    </form>
    ${footer()}`;
}

function paint(focusSelector) {
  render(dialog, view());
  dialog.querySelector('.dialog-body')?.scrollTo(0, 0);
  const target = focusSelector && dialog.querySelector(focusSelector);
  target?.focus();
  if (target) target.scrollIntoView({ block: 'nearest' });
  if (state.step === STEP.WALLET) afterWalletPaint();
}

function updateAmountLabel() {
  const el = dialog.querySelector('[data-amount-label]');
  if (el) el.textContent = Number.isFinite(state.amount) && state.amount > 0 ? fmt(state.amount) : '';
}

// ---------- Navegación entre pasos (con historial) ----------

function goTo(step, focus = '.step-title') {
  if (step > state.step) {
    historyDepth += 1;
    history.pushState({ donateDepth: historyDepth, donateStep: step }, '');
  }
  setStep(step, focus);
}

function setStep(step, focus = '.step-title') {
  if (state.step === STEP.WALLET && step !== STEP.WALLET) stopWallet();
  if (step === STEP.WALLET) {
    state.wallet = { ...(state.wallet ?? initialWallet()), charge: null, status: 'creating', error: '', notice: '' };
  }
  state.step = step;
  state.errors = {};
  state.submitError = '';
  paint(focus);
  if (step === STEP.WALLET) startWallet();
}

function goBack() {
  if (state.step === STEP.DETAILS) readDetails(dialog.querySelector('#donate-form'));
  if (historyDepth > 0) history.back(); // popstate hace el resto
  else setStep(Math.max(0, state.step === STEP.WALLET ? STEP.DETAILS : state.step - 1));
}

function onPopState(e) {
  if (unwinding) {
    unwinding = false;
    history.replaceState(null, '', location.pathname + location.search);
    return;
  }
  if (!dialog.open || !state) return;
  historyDepth = e.state?.donateDepth ?? 0;
  const step = e.state?.donateStep ?? STEP.AMOUNT;
  // Desde la constancia, "atrás" cierra (no se vuelve a pagar).
  if (state.step === STEP.DONE) { dialog.close(); return; }
  if (step < state.step) setStep(step);
}

// ---------- Billetera digital ----------

function remainingText() {
  const charge = state.wallet?.charge;
  if (!charge) return '';
  const ms = Math.max(0, charge.expiresAt.getTime() - Date.now());
  const mm = String(Math.floor(ms / 60000)).padStart(2, '0');
  const ss = String(Math.floor((ms % 60000) / 1000)).padStart(2, '0');
  return `${mm}:${ss}`;
}

function stopWallet() {
  walletTimers.forEach(clearInterval);
  walletTimers = [];
}

async function startWallet() {
  stopWallet();
  state.wallet = { ...(state.wallet ?? initialWallet()), charge: null, status: 'creating', error: '', notice: '' };
  paint();
  try {
    const charge = await paymentProvider.createWalletCharge(requestPayload());
    if (state.step !== STEP.WALLET) return;
    state.wallet.charge = charge;
    state.wallet.status = 'pending';
    paint();
    // Cuenta regresiva (sin repintar todo) y consulta periódica del estado.
    walletTimers.push(setInterval(tickTimer, 1000));
    walletTimers.push(setInterval(() => checkStatus(false), POLL_MS));
  } catch (err) {
    console.error(err);
    state.wallet.status = 'error';
    state.wallet.error = err.message || 'No pudimos generar el pago. Inténtalo nuevamente.';
    paint();
  }
}

function tickTimer() {
  const el = dialog.querySelector('[data-wallet-timer]');
  if (el) el.textContent = remainingText();
  const charge = state.wallet?.charge;
  if (charge && Date.now() >= charge.expiresAt.getTime() && state.wallet.status === 'pending') {
    stopWallet();
    state.wallet.status = 'expired';
    paint();
  }
}

async function checkStatus(manual) {
  const w = state.wallet;
  if (!w?.charge || w.status !== 'pending') return;
  if (manual) { w.checking = true; w.notice = ''; paint(); }
  try {
    const status = await paymentProvider.getChargeStatus(w.charge.id);
    if (state.step !== STEP.WALLET) return;
    if (status === 'paid') { finishWallet(); return; }
    if (status === 'expired') { stopWallet(); w.status = 'expired'; if (!manual) paint(); }
    else if (manual) w.notice = 'Todavía no recibimos tu pago. Si ya lo hiciste, espera unos segundos: se actualizará solo.';
  } catch (err) {
    console.error(err);
    if (manual) w.notice = 'No pudimos verificar en este momento. Seguiremos intentando automáticamente.';
  } finally {
    if (manual && state.step === STEP.WALLET) { w.checking = false; paint(); }
  }
}

function finishWallet() {
  stopWallet();
  const { charge } = state.wallet;
  state.result = {
    ...requestPayload(),
    id: charge.id,
    traceCode: charge.traceCode,
    status: paymentProvider.isTest ? 'test_mode' : 'paid',
    createdAt: new Date(),
  };
  goTo(STEP.DONE);
}

async function afterWalletPaint() {
  const w = state.wallet;
  const canvas = dialog.querySelector('#wallet-qr');
  if (!canvas || !w?.charge) return;
  const size = Math.min(240, window.innerWidth - 120);
  try {
    await drawQR(canvas, w.charge.qrPayload, { size });
  } catch (err) {
    console.error(err);
    w.error = 'No pudimos mostrar el código QR. Puedes pagar con tu código de aprobación de Yape.';
    w.mode = 'code';
    paint();
  }
}

async function payWithCode(form) {
  const w = state.wallet;
  const data = new FormData(form);
  w.phone = String(data.get('phone') ?? '').replace(/\D/g, '');
  w.code = String(data.get('code') ?? '').replace(/\D/g, '');

  const errors = {};
  if (!/^9\d{8}$/.test(w.phone)) errors.phone = 'Escribe tu celular de 9 dígitos (empieza con 9).';
  if (!/^\d{6}$/.test(w.code)) errors.code = 'El código de aprobación tiene 6 números.';
  state.errors = errors;
  if (Object.keys(errors).length) { paint(errors.phone ? '#w-phone' : '#w-code'); return; }

  if (!w.charge) { w.error = 'Espera un momento: estamos preparando tu pago.'; paint(); return; }

  w.paying = true;
  w.error = '';
  paint();
  try {
    const status = await paymentProvider.payWithApprovalCode(w.charge.id, { phone: w.phone, code: w.code });
    w.paying = false;
    if (status === 'paid') { finishWallet(); return; }
    w.error = 'El pago no se completó. Revisa el código e inténtalo de nuevo.';
  } catch (err) {
    w.paying = false;
    w.error = err.message || 'No pudimos procesar el pago. Inténtalo nuevamente.';
  }
  paint('#w-code');
}

// ---------- Lectura y validación ----------

function parseAmount(input) {
  const n = Number(String(input).replace(',', '.').trim());
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : NaN;
}

function readDetails(form) {
  if (!form?.querySelector('#d-email')) return;
  const data = new FormData(form);
  state.donor = {
    name: String(data.get('name') ?? '').trim(),
    email: String(data.get('email') ?? '').trim(),
    consent: data.get('consent') === 'on',
  };
  state.method = String(data.get('method') ?? state.method);
}

function validateStep() {
  const errors = {};
  if (state.step === STEP.AMOUNT) {
    if (!Number.isFinite(state.amount)) errors.amount = 'Elige uno de los montos o escribe uno.';
    else if (state.amount < min) errors.amount = `El monto mínimo es ${money(min)}.`;
    else if (state.amount > max) errors.amount = `Para montos mayores a ${money(max)}, escríbenos para coordinar.`;
  }
  if (state.step === STEP.DETAILS) {
    if (!state.donor.email) errors.email = 'Escribe tu correo para enviarte la constancia.';
    else if (!EMAIL_RE.test(state.donor.email)) errors.email = 'Revisa tu correo. Debe verse así: nombre@correo.com';
    if (!state.donor.consent) errors.consent = 'Marca esta casilla para poder continuar.';
  }
  state.errors = errors;
  return Object.keys(errors);
}

const FIELD_FOR_ERROR = { amount: '#d-custom', email: '#d-email', consent: '[name="consent"]' };

async function submitCardOrTransfer() {
  state.submitting = true;
  state.submitError = '';
  paint();
  try {
    state.result = await paymentProvider.createDonation(requestPayload());
    state.submitting = false;
    goTo(STEP.DONE);
  } catch (err) {
    console.error(err);
    state.submitting = false;
    state.submitError = err.message || 'No pudimos procesar la donación. Inténtalo nuevamente.';
    paint('.step-title');
  }
}

// ---------- API pública ----------

export function setupDonate() {
  dialog = document.getElementById('donate-dialog');
  window.addEventListener('popstate', onPopState);

  dialog.addEventListener('close', () => {
    stopWallet();
    // Retira del historial las entradas de pasos para que "atrás" no reabra el formulario.
    if (historyDepth > 0) {
      unwinding = true;
      const n = historyDepth;
      historyDepth = 0;
      history.go(-n);
    }
  });

  dialog.addEventListener('submit', (e) => {
    e.preventDefault();
    if (state.submitting) return;
    if (state.step === STEP.WALLET) { if (state.wallet.mode === 'code' && !state.wallet.paying) payWithCode(e.target); return; }
    if (state.step === STEP.DETAILS) readDetails(e.target);
    const errorKeys = validateStep();
    if (errorKeys.length) {
      paint(FIELD_FOR_ERROR[errorKeys[0]]);
      return;
    }
    if (state.step === STEP.DETAILS) {
      if (state.method === 'wallet') goTo(STEP.WALLET);
      else submitCardOrTransfer();
      return;
    }
    state.showTargets = false;
    goTo(STEP.DETAILS);
  });

  dialog.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const { action } = btn.dataset;
    if (action === 'back') goBack();
    if (action === 'toggle-targets') {
      state.showTargets = !state.showTargets;
      paint(state.showTargets ? '[name="target"]:checked' : '[data-action="toggle-targets"]');
    }
    if (action === 'print') window.print();
    if (action === 'wallet-mode') {
      state.wallet.mode = btn.dataset.mode;
      state.wallet.error = '';
      state.errors = {};
      paint(state.wallet.mode === 'code' ? '#w-phone' : `[data-mode="qr"]`);
    }
    if (action === 'wallet-renew') startWallet();
    if (action === 'wallet-check') checkStatus(true);
    if (action === 'wallet-save') {
      const canvas = dialog.querySelector('#wallet-qr');
      if (canvas) downloadCanvas(canvas, `qr-donacion-${state.wallet.charge.traceCode}.png`);
    }
    if (action === 'wallet-simulate' && state.wallet?.charge) {
      btn.disabled = true;
      paymentProvider.simulateWalletPayment(state.wallet.charge.id).then(() => checkStatus(false));
    }
  });

  dialog.addEventListener('input', (e) => {
    // Solo números en celular y código.
    if (e.target.classList.contains('input-digits')) {
      e.target.value = e.target.value.replace(/\D/g, '');
      return;
    }
    // El monto se actualiza en vivo en el botón principal.
    if (e.target.name !== 'custom') return;
    const value = e.target.value.trim();
    if (value) {
      dialog.querySelectorAll('[name="preset"]').forEach((r) => { r.checked = false; });
      state.amount = parseAmount(value);
    } else {
      state.amount = NaN;
    }
    updateAmountLabel();
  });

  dialog.addEventListener('change', (e) => {
    if (e.target.name === 'preset') {
      state.amount = Number(e.target.value);
      const custom = dialog.querySelector('#d-custom');
      if (custom) custom.value = '';
      if (state.errors.amount) { state.errors = {}; paint(`[name="preset"][value="${state.amount}"]`); return; }
      updateAmountLabel();
    }
    if (e.target.name === 'target') {
      state.targetKey = e.target.value;
      state.showTargets = false;
      paint('[data-action="toggle-targets"]');
    }
    if (e.target.name === 'method') {
      // El texto del botón y el contador de pasos dependen del método.
      readDetails(dialog.querySelector('#donate-form'));
      const foot = dialog.querySelector('.dialog-foot');
      const tmp = document.createElement('div');
      render(tmp, footer());
      foot.replaceWith(tmp.firstElementChild);
      const { current, total } = progressInfo();
      dialog.querySelector('.dialog-sub').textContent = `Paso ${current} de ${total}`;
      dialog.querySelector('.step-bar > span').style.width = `${Math.round((current / total) * 100)}%`;
    }
  });
}

export async function openDonate({ campaignId, companyId, amount } = {}) {
  const [campaigns, companies] = await Promise.all([api.getCampaigns(), api.getCompanies()]);
  catalog = { campaigns: campaigns.data, companies: companies.data };

  let key = 'general';
  if (campaignId && catalog.campaigns.some((c) => c.id === campaignId)) key = `campaign:${campaignId}`;
  else if (companyId && catalog.companies.some((c) => c.id === companyId)) key = `company:${companyId}`;

  const initialAmount = Number(amount);
  const startAmount = Number.isFinite(initialAmount) && initialAmount >= min && initialAmount <= max
    ? initialAmount : defaultAmount;

  // Si ya está abierto en el mismo destino (p. ej. re-navegación), no reiniciar.
  if (dialog.open && state?.targetKey === key) return;

  state = initialState(key, startAmount);
  historyDepth = 0;
  paint();
  openDialog(dialog);
}
