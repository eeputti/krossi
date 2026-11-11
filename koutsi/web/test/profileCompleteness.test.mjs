// "Profiili 50 % valmis": six parts per role, age and tennis history never counted, short texts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { finnishList, missingText, pctText, profileProgress } from '../src/domain/profileCompleteness.js';

test('an empty coach profile: 0 %, photo and description first', () => {
  const r = profileProgress('coach', { name: 'Anna' });
  assert.equal(r.pct, 0);
  assert.equal(r.total, 6);
  assert.deepEqual(r.missing.map((m) => m.id), ['kuva', 'kuvaus', 'esittely', 'kokemus', 'erikoisalat', 'kaupunki']);
});

test('a full coach profile is 100 % and misses nothing', () => {
  const r = profileProgress('coach', {
    avatarUrl: 'https://x/a.jpg', bio: 'Valmennan junioreita', tagline: 'Tennisvalmentaja', experience: '10 vuotta',
    specialties: ['Juniorit'], area: 'Lahti',
  });
  assert.deepEqual([r.pct, r.done, r.missing.length], [100, 6, 0]);
});

test('blank text and empty lists do not count', () => {
  const r = profileProgress('coach', { avatarUrl: '', bio: '   ', tagline: null, specialties: [], area: 'Rovaniemi' });
  assert.equal(r.done, 1);
  assert.equal(r.pct, 17);
});

test('a player: age and tennis history are never asked for', () => {
  const r = profileProgress('player', { age: 15, tennisStory: 'Pelasin junnuna', area: 'Lahti' });
  assert.equal(r.total, 6);
  assert.equal(r.done, 1);
  assert.ok(!r.missing.some((m) => ['ikä', 'tennistausta'].includes(m.label))); // ("pelikäsi" contains "ikä")
  const full = profileProgress('player', { avatarUrl: 'a', bio: 'Moi', playsHand: 'oikea', favouriteShot: 'rysty', playingSince: 2015, area: 'Lahti' });
  assert.equal(full.pct, 100);
});

test('without the tennis card a player has three parts', () => {
  const r = profileProgress('player', { avatarUrl: 'a', area: 'Lahti' }, { tennis: false });
  assert.deepEqual([r.total, r.done, r.pct], [3, 2, 67]);
  assert.deepEqual(r.missing.map((m) => m.label), ['esittely']);
});

test('texts: Finnish list, "ja N muuta", no-break space before %', () => {
  assert.equal(finnishList(['kuva']), 'kuva');
  assert.equal(finnishList(['kuva', 'kuvaus']), 'kuva ja kuvaus');
  assert.equal(finnishList(['kuva', 'kuvaus', 'kokemus']), 'kuva, kuvaus ja kokemus');
  const m = (...labels) => labels.map((label) => ({ label }));
  assert.equal(missingText(m('kuva', 'kuvaus', 'kokemus')), 'kuva, kuvaus ja kokemus');
  assert.equal(missingText(m('kuva', 'kuvaus', 'kokemus', 'erikoisalat')), 'kuva, kuvaus ja 2 muuta');
  assert.equal(missingText(m('kuva', 'kuvaus', 'kokemus'), 1), 'kuva ja 2 muuta');
  assert.equal(missingText(m('kuva', 'kuvaus'), 1), 'kuva ja kuvaus'); // never "ja 1 muuta"
  assert.equal(pctText(50), '50 % valmis');
  assert.ok(!/·/.test(missingText(m('a', 'b', 'c', 'd', 'e'))));
});
