// "Add to calendar": a one-event iCalendar file (RFC 5545) built in the browser and saved as a
// download. Times are written in UTC, so every calendar app places the pickup correctly.

const PICKUP_MINUTES = 15;
const encoder = new TextEncoder();

const stamp = (date) => date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

/** Escape TEXT values: backslash, semicolon, comma and newlines. */
const text = (value) => String(value).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

/** Fold content lines longer than 75 octets, continuing with a single space. */
function fold(line) {
  const out = [];
  let current = '';
  for (const char of line) {
    if (encoder.encode(current + char).length > (out.length ? 74 : 75)) {
      out.push(current);
      current = char;
    } else {
      current += char;
    }
  }
  out.push(current);
  return out.join('\r\n ');
}

/**
 * order: { code, event: { title, locationName, address }, pickupAt (ISO), items: [{ name, qty }] }
 * directions: a URL for the place, or ''.
 */
export function calendarFile(order, directions) {
  const start = new Date(order.pickupAt);
  const end = new Date(start.getTime() + PICKUP_MINUTES * 60_000);
  const place = [order.event.locationName, order.event.address].filter(Boolean).join(', ');
  const description = [
    `Pickup code ${order.code}. Show it at the pickup table.`,
    '',
    ...order.items.map((item) => `${item.qty} × ${item.name}`),
    directions ? `\nDirections: ${directions}` : '',
  ].join('\n').trim();
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Tsideh//Pickup//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${order.code}@tsideh`,
    `DTSTAMP:${stamp(new Date())}`,
    `DTSTART:${stamp(start)}`,
    `DTEND:${stamp(end)}`,
    `SUMMARY:${text(`Tsideh pickup ${order.code}: ${order.event.title}`)}`,
    `LOCATION:${text(place)}`,
    `DESCRIPTION:${text(description)}`,
    'BEGIN:VALARM',
    'TRIGGER:-PT30M',
    'ACTION:DISPLAY',
    `DESCRIPTION:${text(`Tsideh pickup at ${order.event.locationName}`)}`,
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return `${lines.map(fold).join('\r\n')}\r\n`;
}

export function downloadCalendar(order, directions) {
  const blob = new Blob([calendarFile(order, directions)], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `tsideh-${order.code}.ics`;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
