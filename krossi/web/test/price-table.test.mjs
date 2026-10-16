// Hallin asetukset → Hinnat ja säännöt: the price rules grouped the way a hall reads its price list.
import assert from 'node:assert/strict';
import test from 'node:test';
import { configureTiming } from '../src/api/demo/runtime.js';
import { resetStore } from '../src/api/demo/store.js';
import { backend as api } from '../src/api/demo/index.js';
import { outdoorUntil } from '../src/api/demo/bookingSeed.js';
import { hoursLabel, priceTable, weekdaysLabel } from '../src/screens/booking/priceTable.js';

configureTiming({ latencyMin: 0, latencyMax: 0, autoScale: 0.001 });

test('weekday and hour labels', () => {
  assert.equal(weekdaysLabel([1, 2, 3, 4, 5]), 'Arki');
  assert.equal(weekdaysLabel([6, 7]), 'La–su');
  assert.equal(weekdaysLabel([1, 2, 3, 4, 5, 6, 7]), 'Joka päivä');
  assert.equal(weekdaysLabel([1, 2, 3, 4]), 'ma–to');
  assert.equal(weekdaysLabel([1, 3, 5]), 'ma, ke, pe');
  assert.equal(hoursLabel('06:00', '09:00'), '6–9');
  assert.equal(hoursLabel('09:30', '15:00'), '9.30–15');
  assert.equal(hoursLabel('21:00', '24:00'), '21–24');
});

test('the demo hall: indoor tennis by weekday and weekend, outdoor courts every day', async () => {
  resetStore();
  const [venue] = await api.booking.listVenues();
  const table = priceTable(venue);
  assert.deepEqual(table.map((g) => g.label), ['Sisäkentät', 'Kisapuiston ulkokentät']);
  const [indoor, outdoor] = table;
  assert.deepEqual(indoor.places, ['Janus-Areena', 'Kispi-Areena']);
  assert.deepEqual(indoor.rows.map((r) => r.days), ['Arki', 'La–su']);
  assert.deepEqual(indoor.rows[0].slots.map((s) => `${s.hours} ${s.price}`), ['6–9 18 €/h', '9–15 23 €/h', '15–21 30 €/h', '21–23 23 €/h']);
  assert.deepEqual(indoor.rows[1].slots.map((s) => `${s.hours} ${s.price}`), ['8–21 30 €/h']);
  const hours = hoursLabel('08:00', outdoorUntil(Date.now())); // '8–18' in the autumn, '8–21' in the summer
  assert.deepEqual(outdoor.rows, [{ days: 'Joka päivä', slots: [{ hours, price: '16 €/h' }] }]);
});

test('other sports show up only when asked for', async () => {
  resetStore();
  const [venue] = await api.booking.listVenues();
  const labels = priceTable(venue, ['padel', 'squash']).map((g) => g.label);
  assert.deepEqual(labels, ['Kaikki padelkentät', 'Kaikki squashkentät']);
});
