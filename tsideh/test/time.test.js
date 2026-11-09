import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { buildCatalog } from '../server/catalog.js';
import {
  addDays, dateTimeToUtc, fixedClock, isDateString, isDateTimeString, isTimeString, isTimeZone, localDate, timeLabel, zonedToUtc,
} from '../server/time.js';
import { fixtureContent } from './helpers.js';

const TZ = 'America/Denver';
const iso = (ms) => new Date(ms).toISOString();

describe('zonedToUtc (America/Denver)', () => {
  test('standard time is UTC-7', () => {
    assert.equal(iso(zonedToUtc('2026-11-21', '11:00', TZ)), '2026-11-21T18:00:00.000Z');
    assert.equal(iso(zonedToUtc('2027-01-01', '00:00', TZ)), '2027-01-01T07:00:00.000Z');
  });

  test('daylight time is UTC-6', () => {
    assert.equal(iso(zonedToUtc('2026-07-04', '12:30', TZ)), '2026-07-04T18:30:00.000Z');
  });

  test('fall-back day: daytime uses the new offset, the repeated hour resolves to the earlier instant', () => {
    assert.equal(iso(zonedToUtc('2026-11-01', '00:30', TZ)), '2026-11-01T06:30:00.000Z');
    assert.equal(iso(zonedToUtc('2026-11-01', '01:30', TZ)), '2026-11-01T07:30:00.000Z');
    assert.equal(iso(zonedToUtc('2026-11-01', '03:00', TZ)), '2026-11-01T10:00:00.000Z');
    assert.equal(iso(zonedToUtc('2026-11-01', '11:00', TZ)), '2026-11-01T18:00:00.000Z');
  });

  test('spring-forward day: daytime uses the new offset, the skipped hour resolves forward', () => {
    assert.equal(iso(zonedToUtc('2026-03-08', '01:30', TZ)), '2026-03-08T08:30:00.000Z');
    assert.equal(iso(zonedToUtc('2026-03-08', '02:30', TZ)), '2026-03-08T09:30:00.000Z');
    assert.equal(iso(zonedToUtc('2026-03-08', '05:00', TZ)), '2026-03-08T11:00:00.000Z');
    assert.equal(iso(zonedToUtc('2026-03-08', '11:00', TZ)), '2026-03-08T17:00:00.000Z');
  });

  test('round-trips through localDate', () => {
    for (const date of ['2026-03-07', '2026-03-08', '2026-03-09', '2026-10-31', '2026-11-01', '2026-11-02']) {
      assert.equal(localDate(zonedToUtc(date, '00:00', TZ), TZ), date);
      assert.equal(localDate(zonedToUtc(date, '23:59', TZ), TZ), date);
    }
  });
});

describe('date and time helpers', () => {
  test('localDate uses the site time zone, not UTC', () => {
    assert.equal(localDate(Date.parse('2026-11-11T06:30:00Z'), TZ), '2026-11-10');
    assert.equal(localDate(Date.parse('2026-11-11T07:00:00Z'), TZ), '2026-11-11');
  });

  test('addDays crosses months, years and leap days', () => {
    assert.equal(addDays('2026-11-21', -21), '2026-10-31');
    assert.equal(addDays('2026-12-31', 1), '2027-01-01');
    assert.equal(addDays('2028-03-01', -1), '2028-02-29');
  });

  test('timeLabel renders 12-hour labels', () => {
    assert.equal(timeLabel('00:15'), '12:15 AM');
    assert.equal(timeLabel('09:05'), '9:05 AM');
    assert.equal(timeLabel('12:00'), '12:00 PM');
    assert.equal(timeLabel('13:45'), '1:45 PM');
  });

  test('validators reject impossible dates, times and zones', () => {
    assert.equal(isDateString('2026-02-28'), true);
    assert.equal(isDateString('2026-02-29'), false);
    assert.equal(isDateString('2026-13-01'), false);
    assert.equal(isDateString('26-1-1'), false);
    assert.equal(isTimeString('23:59'), true);
    assert.equal(isTimeString('24:00'), false);
    assert.equal(isTimeString('9:00'), false);
    assert.equal(isTimeZone('America/Denver'), true);
    assert.equal(isTimeZone('Mars/Olympus'), false);
    assert.equal(isDateTimeString('2026-11-20T20:00'), true);
    for (const value of ['2026-11-20 20:00', '2026-11-20T20:00:00', '2026-11-20T20:00Z', '2026-11-31T20:00', '2026-11-20T24:00', '2026-11-20', 'T20:00', 'TT', 20]) {
      assert.equal(isDateTimeString(value), false, String(value));
    }
  });

  test('dateTimeToUtc reads "YYYY-MM-DDTHH:MM" as wall time in the zone', () => {
    assert.equal(iso(dateTimeToUtc('2026-11-20T20:00', TZ)), '2026-11-21T03:00:00.000Z');
    assert.equal(iso(dateTimeToUtc('2026-10-30T20:00', TZ)), '2026-10-31T02:00:00.000Z');
  });

  test('fixedClock always reports the same instant', () => {
    const clock = fixedClock(1234);
    assert.equal(clock.now(), 1234);
    assert.equal(clock.now(), 1234);
  });
});

describe('slot generation', () => {
  function catalogWith(events) {
    const content = fixtureContent();
    content.events.events = events.map((fields) => ({ ...content.events.events[0], itemLimits: {}, ...fields }));
    return buildCatalog(content);
  }

  test('runs from start to end minus one slot, every slotMinutes', () => {
    const catalog = catalogWith([{ id: 'lunch', date: '2026-11-21', start: '11:00', end: '14:00', slotMinutes: 15 }]);
    const slots = catalog.events.get('lunch').slots;
    assert.equal(slots.length, 12);
    assert.equal(slots[0].time, '11:00');
    assert.equal(slots.at(-1).time, '13:45');
    assert.equal(slots.at(-1).label, '1:45 PM');
    assert.equal(iso(slots[0].atMs), '2026-11-21T18:00:00.000Z');
  });

  test('drops a trailing partial slot', () => {
    const catalog = catalogWith([{ id: 'odd', date: '2026-12-19', start: '12:00', end: '13:10', slotMinutes: 20 }]);
    assert.deepEqual(catalog.events.get('odd').slots.map((slot) => slot.time), ['12:00', '12:20', '12:40']);
  });

  test('DST boundary: slots on the fall-back night follow the wall clock', () => {
    const catalog = catalogWith([{ id: 'night', date: '2026-11-01', start: '00:30', end: '03:00', slotMinutes: 30 }]);
    const event = catalog.events.get('night');
    assert.deepEqual(event.slots.map((slot) => [slot.time, iso(slot.atMs)]), [
      ['00:30', '2026-11-01T06:30:00.000Z'],
      ['01:00', '2026-11-01T07:00:00.000Z'],
      ['01:30', '2026-11-01T07:30:00.000Z'],
      ['02:00', '2026-11-01T09:00:00.000Z'],
      ['02:30', '2026-11-01T09:30:00.000Z'],
    ]);
    assert.equal(iso(event.endsAtMs), '2026-11-01T10:00:00.000Z');
  });

  test('DST boundary: pre-order opening is local midnight N days before, across the change', () => {
    const catalog = catalogWith([
      { id: 'after-fall-back', date: '2026-11-21', preorderOpensDaysBefore: 21 },
      { id: 'after-spring-forward', date: '2026-03-20', preorderOpensDaysBefore: 14 },
      { id: 'on-spring-forward', date: '2026-03-08', start: '11:00', end: '12:00', preorderOpensDaysBefore: 0 },
    ]);
    assert.equal(iso(catalog.events.get('after-fall-back').opensAtMs), '2026-10-31T06:00:00.000Z');
    assert.equal(iso(catalog.events.get('after-spring-forward').opensAtMs), '2026-03-06T07:00:00.000Z');
    const spring = catalog.events.get('on-spring-forward');
    assert.equal(iso(spring.opensAtMs), '2026-03-08T07:00:00.000Z');
    assert.equal(iso(spring.slots[0].atMs), '2026-03-08T17:00:00.000Z');
  });

  test('DST boundary: ordersCloseAt keeps its own offset when the pickup is on the other side of the change', () => {
    const catalog = catalogWith([
      { id: 'cutoff-in-daylight-time', date: '2026-11-03', ordersCloseAt: '2026-10-30T20:00' },
      { id: 'cutoff-in-standard-time', date: '2026-03-10', ordersCloseAt: '2026-03-06T20:00' },
    ]);
    assert.equal(iso(catalog.events.get('cutoff-in-daylight-time').ordersCloseAtMs), '2026-10-31T02:00:00.000Z');
    assert.equal(iso(catalog.events.get('cutoff-in-daylight-time').startsAtMs), '2026-11-03T18:00:00.000Z');
    assert.equal(iso(catalog.events.get('cutoff-in-standard-time').ordersCloseAtMs), '2026-03-07T03:00:00.000Z');
    assert.equal(iso(catalog.events.get('cutoff-in-standard-time').startsAtMs), '2026-03-10T17:00:00.000Z');
  });

  test('events are sorted by start time', () => {
    const catalog = buildCatalog(fixtureContent());
    const starts = catalog.eventList.map((event) => event.startsAtMs);
    assert.deepEqual(starts, [...starts].sort((a, b) => a - b));
  });
});
