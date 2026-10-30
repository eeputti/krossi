// The error phrasebook (src/api/errors.js): our own Finnish sentences from SQL reach the coach as they
// are, also those without ä/ö (the valmentaja-avain answers), never as "Jokin meni pieleen".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toApiError } from '../src/api/errors.js';

test('valmentaja-avain answers from koutsi_use_code / koutsi_admin_create_trial_code are shown as they are', () => {
  for (const msg of [
    'Kirjoita valmentaja-avain.',
    'Avaimessa saa olla 4–30 kirjainta, numeroa tai plussaa.',
    'Koutsi on sinulle jo maksuton, joten avainta ei tarvita.',
    'Tämä avain toimii vain uuden tilin luonnissa.',
  ]) {
    assert.equal(toApiError({ message: msg, code: 'P0001' }).userMessage, msg);
  }
  assert.equal(toApiError({ message: 'invalid coach key' }).userMessage, 'Väärä valmentaja-avain.');
  assert.equal(toApiError({ message: 'something odd' }).userMessage, 'Jokin meni pieleen. Yritä uudelleen.');
});
