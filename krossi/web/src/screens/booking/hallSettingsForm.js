// hallSettingsForm.js — what the Hallin asetukset view and its sheets share: text typed into the
// fields -> the numbers the API takes ('26,50' -> 2650 cents, '25,5' -> 25.5) and back, and the
// short labels the lists print. Empty text is null; anything unreadable is NaN, which the checks in
// features/seasons.js refuse with the field's own message.

const clean = (text) => String(text ?? '').trim().replace(/\s/g, '').replace(',', '.');

/** '26,50' | '26.5' | '26' -> cents (2650); '' -> null; otherwise NaN. */
export function centsFromInput(text) {
  const value = clean(text);
  if (!value) return null;
  if (!/^\d+(\.\d{1,2})?$/.test(value)) return Number.NaN;
  return Math.round(Number(value) * 100);
}

/** '25,5' -> 25.5; '' -> null; otherwise NaN. */
export function numberFromInput(text) {
  const value = clean(text);
  if (!value) return null;
  return /^\d+(\.\d+)?$/.test(value) ? Number(value) : Number.NaN;
}

/** '14' -> 14; '' -> null; otherwise NaN (also '14,5'). */
export function intFromInput(text) {
  const value = clean(text);
  if (!value) return null;
  return /^\d+$/.test(value) ? Number(value) : Number.NaN;
}

/** 2650 -> '26,50', 2600 -> '26', null -> ''. */
export function centsToInput(cents) {
  if (cents == null || Number.isNaN(cents)) return '';
  return cents % 100 ? (cents / 100).toFixed(2).replace('.', ',') : String(cents / 100);
}

/** 25.5 -> '25,5', null -> ''. */
export function numberToInput(value) {
  return value == null || Number.isNaN(value) ? '' : String(value).replace('.', ',');
}

/** Validity in days as the shop says it: 365 -> '12 kk', 45 -> '1 kk', 14 -> '14 pv'. */
export function validityLabel(days) {
  return days >= 28 ? `${Math.round(days / 30.4)} kk` : `${days} pv`;
}

/** Validity choices: [{ value, label }] with `current` kept when it isn't one of them. */
export function validityOptions(choices, current) {
  const days = [...new Set([...choices, ...(Number.isInteger(current) ? [current] : [])])].sort((a, b) => a - b);
  return days.map((d) => ({ value: String(d), label: validityLabel(d) }));
}

export const PRODUCT_VALIDITY = [30, 60, 90, 120, 180, 365, 730];
export const GIFT_VALIDITY = [180, 365, 730, 1095];
export const USE_MINUTES = [30, 60, 90, 120, 150, 180, 240];
