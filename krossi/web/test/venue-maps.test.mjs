// Venue floor maps (screens/booking/venueMaps.js): every map has its courts, they sit inside the
// map without overlapping, and the demo hall's courts all find their place on a map.
import assert from 'node:assert/strict';
import test from 'node:test';
import { VENUE_MAPS, hasVenueMap } from '../src/screens/booking/venueMaps.js';
import { createBookingSeed } from '../src/api/demo/bookingSeed.js';

const range = (prefix, from, to) => Array.from({ length: to - from + 1 }, (_, i) => `${prefix}${from + i}`);

const EXPECTED = {
  'lahti-janus': [...range('te', 1, 4), 'padel', ...range('sulka', 1, 7)],
  'lahti-kispi': [...range('te', 1, 4), ...range('sulka', 1, 5), 'squash1'],
  'lahti-kisapuisto': range('ulko', 1, 6),
};
const INDOOR = ['lahti-janus', 'lahti-kispi'];

const inside = ([vx, vy, vw, vh], x, y, w, h) => x >= vx && y >= vy && x + w <= vx + vw && y + h <= vy + vh;
const contains = (outer, r) => r.x >= outer.x && r.y >= outer.y && r.x + r.w <= outer.x + outer.w && r.y + r.h <= outer.y + outer.h;
const overlap = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

test('every map has exactly the expected courts', () => {
  assert.deepEqual(Object.keys(VENUE_MAPS).sort(), Object.keys(EXPECTED).sort());
  for (const [key, ids] of Object.entries(EXPECTED)) {
    assert.deepEqual(Object.keys(VENUE_MAPS[key].courts).sort(), [...ids].sort(), key);
  }
});

test('courts are well formed, inside the map and never overlap', () => {
  for (const [key, map] of Object.entries(VENUE_MAPS)) {
    const courts = Object.entries(map.courts);
    for (const [id, c] of courts) {
      const where = `${key} ${id}`;
      assert.ok(c.w > 0 && c.h > 0, `${where}: positive size`);
      assert.ok(inside(map.viewBox, c.x, c.y, c.w, c.h), `${where}: inside the viewBox`);
      assert.ok(['tennis', 'padel', 'sulka', 'squash'].includes(c.kind), `${where}: kind`);
      // the long axis matches the orientation, so the court lines come out the right way round
      assert.ok(c.orientation === 'v' ? c.h >= c.w : c.orientation === 'h' && c.w >= c.h, `${where}: orientation`);
      assert.ok(c.label && c.short, `${where}: default labels`);
    }
    for (let i = 0; i < courts.length; i++) {
      for (let j = i + 1; j < courts.length; j++) {
        assert.ok(!overlap(courts[i][1], courts[j][1]), `${key}: ${courts[i][0]} overlaps ${courts[j][0]}`);
      }
    }
  }
});

test('indoor courts lie inside a hall, and labels and entrances stay on the map', () => {
  for (const key of INDOOR) {
    const halls = VENUE_MAPS[key].features.filter((f) => f.type === 'building');
    for (const [id, c] of Object.entries(VENUE_MAPS[key].courts)) {
      assert.ok(halls.some((h) => contains(h, c)), `${key} ${id}: inside a building`);
    }
  }
  for (const [key, map] of Object.entries(VENUE_MAPS)) {
    assert.ok(map.title && map.place?.label, `${key}: title and place label`);
    assert.ok(inside(map.viewBox, ...map.place.box), `${key}: place label inside the map`);
    for (const f of map.features.filter((x) => x.label)) {
      assert.ok(inside(map.viewBox, ...(f.box || [f.x, f.y, f.w, f.h])), `${key}: label "${f.label}" inside the map`);
    }
    for (const e of map.entrances) {
      assert.ok(['up', 'down', 'left', 'right'].includes(e.dir), `${key}: entrance direction`);
      assert.ok(inside(map.viewBox, e.x, e.y, 0, 0) && inside(map.viewBox, ...e.box), `${key}: entrance inside the map`);
    }
  }
});

test('hasVenueMap knows exactly the three maps', () => {
  for (const key of Object.keys(EXPECTED)) assert.equal(hasVenueMap(key), true, key);
  for (const key of [null, undefined, '', 'lahti', 'toString', '__proto__', 'constructor']) assert.equal(hasVenueMap(key), false, String(key));
});

test('every demo court with a mapId has a place on its location map', () => {
  const { venues } = createBookingSeed(Date.now());
  let checked = 0;
  for (const venue of venues) {
    for (const location of venue.locations) {
      if (!location.mapKey) continue;
      assert.ok(hasVenueMap(location.mapKey), `${location.name}: unknown mapKey ${location.mapKey}`);
      for (const court of location.courts) {
        if (!court.mapId) continue;
        assert.ok(VENUE_MAPS[location.mapKey].courts[court.mapId], `${location.name} ${court.name}: mapId ${court.mapId} not on the map`);
        checked += 1;
      }
    }
  }
  assert.ok(checked > 0, 'the demo seed placed no courts');
});
