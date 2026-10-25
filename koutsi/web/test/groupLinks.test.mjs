// Kauden ryhmälinkki: how long a link lasts, which code is the season link, joined counts and the
// one message for every group.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { groupLinksMessage, isSeasonLink, joinedCount, joinedTotals, seasonLinkDays, seasonLinkFor } from '../src/domain/groupLinks.js';
import { backend as demo, configureDemo } from '../src/api/demo/index.js';

test('a season link lasts to a week after the season, within the server cap', () => {
  assert.equal(seasonLinkDays({ endsOn: '2026-12-13' }, '2026-10-23'), 58);
  assert.equal(seasonLinkDays({ endsOn: '2027-05-23' }, '2026-10-23'), 180);
  assert.equal(seasonLinkDays(null, '2026-10-23'), 120);
  assert.equal(seasonLinkDays({ endsOn: '2026-01-01' }, '2026-10-23'), 120, 'an ended season: a plain default');
});

test('the season link is the newest whole-group code of the group', () => {
  const codes = [
    { code: 'ONE111', groupId: 'g1', active: true, maxUses: 1, createdAt: '2026-10-20' },
    { code: 'OLD222', groupId: 'g1', active: true, maxUses: 100, createdAt: '2026-10-01' },
    { code: 'NEW333', groupId: 'g1', active: true, maxUses: 100, createdAt: '2026-10-22' },
    { code: 'GONE44', groupId: 'g1', active: false, maxUses: 100, createdAt: '2026-10-23' },
    { code: 'OTHER5', groupId: 'g2', active: true, maxUses: 100, createdAt: '2026-10-23' },
  ];
  assert.equal(seasonLinkFor(codes, 'g1').code, 'NEW333');
  assert.equal(seasonLinkFor(codes, 'g3'), null);
  assert.equal(isSeasonLink(codes[0]), false);
});

test('joined counts and one message for every group', () => {
  const state = { students: [{ id: 'a', isPlaceholder: false }, { id: 'b', isPlaceholder: true }, { id: 'c', isPlaceholder: false }] };
  assert.deepEqual(joinedCount(state, { memberIds: ['a', 'b', 'c'] }), { joined: 2, total: 3 });
  assert.deepEqual(joinedTotals(state, [{ memberIds: ['a', 'b'] }, { memberIds: ['a', 'c'] }]), { joined: 2, total: 3 }, 'a player in two groups counts once');
  const msg = groupLinksMessage({
    coachName: 'Anna Koskinen',
    season: { name: 'Kevät 2027', startsOn: '2027-01-11' },
    rows: [{ group: { day: 'Ti', time: '17:00', name: 'Aikuiset edistyneet' }, code: 'ABC234' }, { group: { day: 'To', time: '18:00', name: 'X' }, code: null }],
    today: '2026-12-01',
  });
  assert.match(msg, /^Anna täällä! Kevät 2027 alkaa ma 11\.1\. Liity Krossi Koutsiin/);
  assert.match(msg, /Ti 17:00 · Aikuiset edistyneet\nhttps:\/\/koutsi\.krossi\.app\/pelaaja\?koodi=ABC234/);
  assert.ok(!msg.includes('· X'), 'a group without a link is left out');
  assert.match(msg, /Alaikäiset liittyvät/);
});

test('demo: a season link is made once and then reused', async () => {
  configureDemo({ role: 'coach', latency: 0 });
  await demo.invites.create('demo-g-ti-aik1', { maxUses: 100, expiresDays: 58 });
  const codes = await demo.invites.list('demo-coach');
  const link = seasonLinkFor(codes, 'demo-g-ti-aik1');
  assert.ok(link && link.maxUses === 100);
  assert.match(link.code, /^[A-HJ-NP-Z2-9]{6}$/);
  configureDemo({ role: 'coach', latency: 0 });
});
