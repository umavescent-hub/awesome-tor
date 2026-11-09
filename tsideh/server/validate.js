// Input cleaning and validation for everything customers type. All strings are trimmed and have
// control, zero-width and bidi-override characters removed before length checks.

import { invalid } from './http.js';
import { isDateString } from './time.js';

const INVISIBLE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F​-‏‪-‮⁠-⁤⁦-⁩﻿]/g;
const EMAIL = /^[^\s@]{1,64}@[^\s@]+\.[^\s@]{2,}$/;
const PHONE = /^[0-9+()\-. ]{7,20}$/;

export const isPlainObject = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);

export function cleanText(value, { multiline = false } = {}) {
  const stripped = value.replace(INVISIBLE, '');
  if (!multiline) return stripped.replace(/\s+/g, ' ').trim();
  return stripped
    .replace(/\r\n?/g, '\n')
    .replace(/[^\S\n]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * A free-text field. `label` reads naturally after "Enter" / before "is too long",
 * e.g. "your name".
 */
export function text(value, { field, label, min = 0, max, multiline = false }) {
  if (value === undefined || value === null) value = '';
  if (typeof value !== 'string') throw invalid(field, `Enter ${label} as text.`);
  const cleaned = cleanText(value, { multiline });
  if (cleaned.length < min) throw invalid(field, `Enter ${label}.`);
  if (cleaned.length > max) throw invalid(field, `Keep ${label} to ${max} characters or fewer.`);
  return cleaned;
}

export function email(value, field) {
  const cleaned = text(value, { field, label: 'your email', min: 1, max: 254 });
  if (!EMAIL.test(cleaned)) throw invalid(field, 'Enter a valid email address.');
  return cleaned;
}

export function phone(value, field, { required }) {
  const cleaned = text(value, { field, label: 'your phone number', min: required ? 1 : 0, max: 20 });
  if (cleaned === '') return '';
  if (!PHONE.test(cleaned) || cleaned.replace(/\D/g, '').length < 7) throw invalid(field, 'Enter a valid phone number.');
  return cleaned;
}

export function date(value, field) {
  if (!isDateString(value)) throw invalid(field, 'Choose a date.');
  return value;
}

/** Whole number in range; numeric strings from form fields are accepted. */
export function integer(value, field, { min, max, message }) {
  const number = typeof value === 'string' && /^\d{1,9}$/.test(value.trim()) ? Number(value.trim()) : value;
  if (!Number.isInteger(number) || number < min || number > max) throw invalid(field, message);
  return number;
}

export function oneOf(value, field, choices, message) {
  if (!choices.includes(value)) throw invalid(field, message);
  return value;
}

export function customer(value) {
  if (!isPlainObject(value)) throw invalid('customer', 'Enter your name, email and phone number.');
  return {
    name: text(value.name, { field: 'customer.name', label: 'your name', min: 1, max: 80 }),
    email: email(value.email, 'customer.email'),
    phone: phone(value.phone, 'customer.phone', { required: true }),
  };
}
