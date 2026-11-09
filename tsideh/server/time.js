// Time zone math with Intl only. Event dates and times in config are local wall time in the
// site's time zone; everything stored or compared is a UTC epoch in milliseconds.

const formatters = new Map();

function formatterFor(timeZone) {
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatters.set(timeZone, formatter);
  }
  return formatter;
}

export function isTimeZone(value) {
  if (typeof value !== 'string' || value === '') return false;
  try {
    formatterFor(value);
    return true;
  } catch {
    return false;
  }
}

/** Wall-clock fields of an instant as seen in `timeZone`. */
function wallClock(ms, timeZone) {
  const fields = {};
  for (const { type, value } of formatterFor(timeZone).formatToParts(ms)) fields[type] = Number(value);
  return {
    year: fields.year,
    month: fields.month,
    day: fields.day,
    hour: fields.hour,
    minute: fields.minute,
    second: fields.second,
  };
}

/** UTC offset of `timeZone` at an instant, in ms (America/Denver in winter: -7h). */
function offsetAt(ms, timeZone) {
  const wall = wallClock(ms, timeZone);
  const wallAsUtc = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second);
  return wallAsUtc - Math.floor(ms / 1000) * 1000;
}

/**
 * The instant at which the wall clock in `timeZone` reads `date` `time`.
 * Repeated times (fall back) resolve to the earlier instant; skipped times (spring forward)
 * resolve forward by the length of the gap, matching Temporal's "compatible" disambiguation.
 */
export function zonedToUtc(date, time, timeZone) {
  const [year, month, day] = date.split('-').map(Number);
  const [hour, minute] = time.split(':').map(Number);
  const wall = Date.UTC(year, month - 1, day, hour, minute);
  const first = wall - offsetAt(wall, timeZone);
  const firstOffset = offsetAt(first, timeZone);
  if (wall - firstOffset === first) return first;
  const second = wall - firstOffset;
  if (wall - offsetAt(second, timeZone) === second) return second;
  return first;
}

const pad = (n) => String(n).padStart(2, '0');

/** Local calendar date ("YYYY-MM-DD") of an instant in `timeZone`. */
export function localDate(ms, timeZone) {
  const { year, month, day } = wallClock(ms, timeZone);
  return `${year}-${pad(month)}-${pad(day)}`;
}

export function isDateString(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const probe = new Date(Date.UTC(year, month - 1, day));
  return probe.getUTCFullYear() === year && probe.getUTCMonth() === month - 1 && probe.getUTCDate() === day;
}

export function isTimeString(value) {
  return typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

/** Calendar arithmetic on "YYYY-MM-DD" strings (no time zone involved). */
export function addDays(date, days) {
  const [year, month, day] = date.split('-').map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, day + days));
  return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`;
}

export function minutesOf(time) {
  const [hour, minute] = time.split(':').map(Number);
  return hour * 60 + minute;
}

export function timeOf(minutes) {
  return `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
}

/** "13:45" -> "1:45 PM" */
export function timeLabel(time) {
  const [hour, minute] = time.split(':').map(Number);
  const suffix = hour < 12 ? 'AM' : 'PM';
  return `${hour % 12 || 12}:${pad(minute)} ${suffix}`;
}

export function toIso(ms) {
  return ms === null || ms === undefined ? null : new Date(ms).toISOString();
}

/** The single source of "now" for the whole server. A fixed clock is for tests and previews. */
export function systemClock() {
  return { now: () => Date.now() };
}

export function fixedClock(ms) {
  return { now: () => ms };
}
