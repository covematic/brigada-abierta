import { config } from '../config.js';

const currencyFmt = new Intl.NumberFormat(config.locale, {
  style: 'currency', currency: config.currency, maximumFractionDigits: 0,
});
const currencyExactFmt = new Intl.NumberFormat(config.locale, {
  style: 'currency', currency: config.currency, minimumFractionDigits: 2,
});
const numberFmt = new Intl.NumberFormat(config.locale);
const dateFmt = new Intl.DateTimeFormat(config.locale, { day: 'numeric', month: 'short', year: 'numeric' });
const dateTimeFmt = new Intl.DateTimeFormat(config.locale, { dateStyle: 'medium', timeStyle: 'short' });

export const money = (n) => currencyFmt.format(n);
export const moneyExact = (n) => currencyExactFmt.format(n);
export const number = (n) => numberFmt.format(n);
// Las fechas "YYYY-MM-DD" se interpretan como fecha local, no UTC.
const parseDate = (iso) => (iso.length === 10 ? new Date(`${iso}T00:00:00`) : new Date(iso));
export const date = (iso) => dateFmt.format(parseDate(iso));
export const dateTime = (d) => dateTimeFmt.format(d);

export const percent = (raised, goal) =>
  goal > 0 ? Math.min(100, Math.round((raised / goal) * 100)) : 0;

export function daysLeft(iso, today = new Date()) {
  const end = parseDate(iso);
  const ms = end.setHours(23, 59, 59) - today.getTime();
  return Math.max(0, Math.ceil(ms / 86_400_000));
}

export const formatMetric = (value, format) =>
  format === 'currency' ? money(value) : number(value);

/** ['A', 'B', 'C'] → 'A, B y C' */
export const listJoin = (items = []) =>
  items.length < 2 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} y ${items.at(-1)}`;

export const PRIORITY_LABEL = { high: 'Crítica', medium: 'Media', low: 'Baja' };
