// Money, dates and times. Every date and time is shown in the kitchen's zone (America/Denver),
// whatever zone the visitor's device is set to.

const TIME_ZONE = 'America/Denver';

const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
const shortDate = new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
const longDate = new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' });
const zonedDay = new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: TIME_ZONE });
const zonedTime = new Intl.DateTimeFormat('en-CA', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: TIME_ZONE });

export const formatMoney = (cents) => money.format(cents / 100);

/** 'YYYY-MM-DD' (a local calendar date) to a UTC-noon Date, so formatting never shifts the day. */
function calendarDate(date) {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12));
}

/** "Sat, Nov 21" */
export const formatDate = (date) => shortDate.format(calendarDate(date));

/** "Saturday, November 21" */
export const formatLongDate = (date) => longDate.format(calendarDate(date));

const monthDay = new Intl.DateTimeFormat('en-US', { month: 'long', day: 'numeric', timeZone: 'UTC' });
const weekday = new Intl.DateTimeFormat('en-US', { weekday: 'long', timeZone: 'UTC' });

/** "November 21" and "Saturday" */
export const formatMonthDay = (date) => monthDay.format(calendarDate(date));
export const formatWeekday = (date) => weekday.format(calendarDate(date));

/** { weekday: 'Sat', month: 'Nov', day: '21' } */
export function dateParts(date) {
  const out = {};
  for (const part of shortDate.formatToParts(calendarDate(date))) {
    if (part.type !== 'literal') out[part.type] = part.value;
  }
  return out;
}

/** "11:15" (24h wall time) to "11:15 AM". */
export function formatTime(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  const suffix = h < 12 ? 'AM' : 'PM';
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, '0')} ${suffix}`;
}

/** "11:00 AM – 2:00 PM" */
export const formatTimeRange = (start, end) => `${formatTime(start)} – ${formatTime(end)}`;

/** An ISO instant as the kitchen's calendar date 'YYYY-MM-DD'. */
export const zonedDate = (iso) => zonedDay.format(new Date(iso));

/** An ISO instant as the kitchen's wall time "HH:MM". */
export const zonedClock = (iso) => zonedTime.format(new Date(iso));

/** Today's date in the kitchen's zone. */
export const today = () => zonedDay.format(new Date());

/** Calendar arithmetic on 'YYYY-MM-DD'. */
export function addDays(date, days) {
  const d = calendarDate(date);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * `percent` of `cents`, rounded half-up to a whole cent, with the same integer arithmetic as the
 * server so the totals shown before checkout match the charge exactly.
 */
export function percentOf(cents, percent) {
  const perMillion = Math.round(percent * 10_000);
  return Math.floor((cents * perMillion + 500_000) / 1_000_000);
}

const STATUS = {
  open: 'Open for orders',
  soldout: 'Sold out',
  paused: 'Orders paused',
  closed: 'Orders closed',
};

/** A pop-up's ordering status in words: "Open for orders", "Orders open Sat, Oct 31", ... */
export function eventStatusLabel(event) {
  if (event.status === 'upcoming') return `Orders open ${formatDate(zonedDate(event.opensAt))}`;
  return STATUS[event.status] ?? STATUS.closed;
}
