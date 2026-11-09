import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { ApiError } from '../server/http.js';
import * as validate from '../server/validate.js';

function rejects(fn, field) {
  assert.throws(fn, (error) => error instanceof ApiError && error.status === 400 && error.field === field);
}

describe('cleanText', () => {
  test('trims, collapses whitespace and strips control characters', () => {
    assert.equal(validate.cleanText('  Maria\t\u0000 Ortiz\u0007 \n'), 'Maria Ortiz');
  });

  test('strips zero-width and bidi-override characters used for spoofing', () => {
    assert.equal(validate.cleanText('Ma​ria ‮zitro‬'), 'Maria zitro');
    assert.equal(validate.cleanText('﻿hello⁦'), 'hello');
  });

  test('multiline keeps paragraphs but normalizes line endings and blank runs', () => {
    assert.equal(validate.cleanText('  No onions.\r\n\r\n\r\n\r\nExtra   salsa \n', { multiline: true }), 'No onions.\n\nExtra salsa');
  });
});

describe('field validators', () => {
  test('text enforces presence and length after cleaning', () => {
    assert.equal(validate.text('  Ana  ', { field: 'name', label: 'your name', min: 1, max: 80 }), 'Ana');
    rejects(() => validate.text('   ​ ', { field: 'name', label: 'your name', min: 1, max: 80 }), 'name');
    rejects(() => validate.text('x'.repeat(81), { field: 'name', label: 'your name', min: 1, max: 80 }), 'name');
    rejects(() => validate.text(42, { field: 'name', label: 'your name', min: 1, max: 80 }), 'name');
    assert.equal(validate.text(undefined, { field: 'notes', label: 'notes', max: 300 }), '');
  });

  test('email', () => {
    assert.equal(validate.email(' maria@example.com ', 'email'), 'maria@example.com');
    for (const bad of ['', 'maria', 'maria@', 'maria@example', 'a b@example.com', `${'x'.repeat(65)}@example.com`, `a@${'x'.repeat(250)}.com`]) {
      rejects(() => validate.email(bad, 'email'), 'email');
    }
  });

  test('phone: 7-20 allowed characters with at least 7 digits', () => {
    assert.equal(validate.phone('(505) 555-0142', 'phone', { required: true }), '(505) 555-0142');
    assert.equal(validate.phone('+1 505.555.0142', 'phone', { required: true }), '+1 505.555.0142');
    assert.equal(validate.phone('', 'phone', { required: false }), '');
    rejects(() => validate.phone('', 'phone', { required: true }), 'phone');
    rejects(() => validate.phone('555-01', 'phone', { required: true }), 'phone');
    rejects(() => validate.phone('(((---)))', 'phone', { required: true }), 'phone');
    rejects(() => validate.phone('505 555 0142 ext 9', 'phone', { required: true }), 'phone');
    rejects(() => validate.phone('1'.repeat(21), 'phone', { required: true }), 'phone');
  });

  test('integer accepts numbers and digit strings within range', () => {
    const range = { min: 10, max: 500, message: 'Out of range.' };
    assert.equal(validate.integer(40, 'guestCount', range), 40);
    assert.equal(validate.integer(' 40 ', 'guestCount', range), 40);
    for (const bad of [9, 501, 40.5, '4e1', '', null, true]) rejects(() => validate.integer(bad, 'guestCount', range), 'guestCount');
  });

  test('customer requires name, email and phone', () => {
    assert.deepEqual(validate.customer({ name: ' Ana Lucero ', email: 'ana@example.com', phone: '5055550142' }), {
      name: 'Ana Lucero',
      email: 'ana@example.com',
      phone: '5055550142',
    });
    rejects(() => validate.customer(null), 'customer');
    rejects(() => validate.customer({ email: 'ana@example.com', phone: '5055550142' }), 'customer.name');
    rejects(() => validate.customer({ name: 'Ana', phone: '5055550142' }), 'customer.email');
    rejects(() => validate.customer({ name: 'Ana', email: 'ana@example.com' }), 'customer.phone');
  });

  test('date, bool and oneOf', () => {
    assert.equal(validate.date('2026-12-12', 'eventDate'), '2026-12-12');
    rejects(() => validate.date('12/12/2026', 'eventDate'), 'eventDate');
    assert.equal(validate.bool(false, 'paused'), false);
    rejects(() => validate.bool('false', 'paused'), 'paused');
    assert.equal(validate.oneOf('Buffet', 'serviceStyle', ['Buffet'], 'Pick one.'), 'Buffet');
    rejects(() => validate.oneOf('buffet', 'serviceStyle', ['Buffet'], 'Pick one.'), 'serviceStyle');
  });
});
