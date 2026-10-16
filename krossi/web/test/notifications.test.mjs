// Ilmoitukset: the bell's list is built from data the player already has.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { buildNotifications, countNew, MAX_NOTIFICATIONS } from '../src/features/notifications.js';

const local = (y, mo, d, h = 18, mi = 0) => new Date(y, mo - 1, d, h, mi);
const iso = (...args) => local(...args).toISOString();
const NOW = local(2026, 10, 14, 12).getTime(); // Wednesday noon

const person = (id, name = `Pelaaja ${id}`) => ({ id, name, avatarUrl: null, avatarColor: 'blue' });
const game = (id, extra = {}) => ({
  id, kind: 'open', status: 'open', matchType: 'kaksinpeli', title: null, creator: person('c'), participants: [],
  locationName: 'Kispi Areena', city: 'Tampere', scheduledAt: iso(2026, 10, 16), createdAt: iso(2026, 10, 13, 9),
  isMine: false, iJoined: false, ...extra,
});

describe('buildNotifications', () => {
  test('lists each kind with a title that says what happened', () => {
    const items = buildNotifications({
      uid: 'me',
      now: NOW,
      areas: ['Tampere'],
      invites: [{ id: 'i1', game: game('g1', { creator: person('a', 'Aino Virtanen') }) }],
      requests: [{ id: 'r1', from: person('b', 'Mikko'), message: 'Pelataanko la?', createdAt: iso(2026, 10, 14, 8) }],
      conversations: [{ id: 'c1', isGroup: false, title: 'Sofia', participants: [person('s', 'Sofia')], unread: true, updatedAt: iso(2026, 10, 14, 11), lastMessage: { text: 'Moi!', senderId: 's', createdAt: iso(2026, 10, 14, 11), kind: 'text' } }],
      outcomes: [game('g2', { scheduledAt: iso(2026, 10, 12), iJoined: true })],
      upcoming: [game('g3', { scheduledAt: iso(2026, 10, 14, 18), isMine: true })],
      open: [game('g4', { creator: person('d', 'Leo'), createdAt: iso(2026, 10, 14, 10) })],
    });
    const byKind = Object.fromEntries(items.map((i) => [i.kind, i]));
    assert.equal(byKind.invite.title, 'Aino kutsui sinut peliin');
    assert.equal(byKind.request.title, 'Mikko pyytää pelaamaan');
    assert.equal(byKind.request.body, '“Pelataanko la?”');
    assert.equal(byKind.message.title, 'Sofia lähetti viestin');
    assert.equal(byKind.message.to, '/pelaa/viestit/c1');
    assert.equal(byKind.outcome.title, 'Pelasitteko? Kaksinpeli');
    assert.equal(byKind.soon.title, 'Peli tänään klo 18');
    assert.equal(byKind.newGame.title, 'Leo avasi pelin');
  });

  test('newest first', () => {
    const items = buildNotifications({
      now: NOW,
      requests: [
        { id: 'old', from: person('a'), message: '', createdAt: iso(2026, 10, 10) },
        { id: 'new', from: person('b'), message: '', createdAt: iso(2026, 10, 14, 9) },
      ],
    });
    assert.deepEqual(items.map((i) => i.id), ['request:new', 'request:old']);
  });

  test('skips read chats and my own last message', () => {
    const chat = (id, extra) => ({ id, isGroup: false, title: 'X', participants: [person('x')], updatedAt: iso(2026, 10, 14), lastMessage: { text: 'hei', senderId: 'x', createdAt: iso(2026, 10, 14), kind: 'text' }, ...extra });
    const items = buildNotifications({
      uid: 'me',
      now: NOW,
      conversations: [
        chat('read', { unread: false }),
        chat('mine', { unread: true, lastMessage: { text: 'hei', senderId: 'me', createdAt: iso(2026, 10, 14), kind: 'text' } }),
        chat('new', { unread: true }),
      ],
    });
    assert.deepEqual(items.map((i) => i.id.split(':')[1]), ['new']);
  });

  test('a group chat names the sender', () => {
    const [item] = buildNotifications({
      uid: 'me',
      now: NOW,
      conversations: [{ id: 'g', isGroup: true, title: 'Kaksinpeli', participants: [person('a', 'Aino'), person('b', 'Ben')], unread: true, updatedAt: iso(2026, 10, 14), lastMessage: { text: null, senderId: 'b', createdAt: iso(2026, 10, 14), kind: 'thumbs' } }],
    });
    assert.equal(item.title, 'Uusi viesti: Kaksinpeli');
    assert.equal(item.body, 'Ben: 👍');
  });

  test('only games starting within 24 hours remind', () => {
    const items = buildNotifications({
      now: NOW,
      upcoming: [
        game('tomorrow', { scheduledAt: iso(2026, 10, 15, 9, 30) }),
        game('later', { scheduledAt: iso(2026, 10, 16, 18) }),
        game('open-time', { scheduledAt: null }),
        game('cancelled', { scheduledAt: iso(2026, 10, 14, 19), status: 'cancelled' }),
      ],
    });
    assert.deepEqual(items.map((i) => i.id), ['soon:tomorrow']);
    assert.equal(items[0].title, 'Peli huomenna klo 9.30');
  });

  test('new games: only others\', open, in my cities, from the last week, not already over', () => {
    const items = buildNotifications({
      now: NOW,
      areas: ['Tampere', 'Lahti'],
      open: [
        game('ok'),
        game('lahti', { city: 'Lahti' }),
        game('elsewhere', { city: 'Oulu' }),
        game('mine', { isMine: true }),
        game('joined', { iJoined: true }),
        game('full', { status: 'filled' }),
        game('stale', { createdAt: iso(2026, 10, 1) }),
        game('over', { scheduledAt: iso(2026, 10, 14, 9) }),
      ],
    });
    assert.deepEqual(items.map((i) => i.id).sort(), ['game:lahti', 'game:ok']);
  });

  test('a game I was invited to is not also listed as new', () => {
    const g = game('g1');
    const items = buildNotifications({ now: NOW, areas: ['Tampere'], invites: [{ id: 'i1', game: g }], open: [g] });
    assert.deepEqual(items.map((i) => i.kind), ['invite']);
  });

  test('caps the list', () => {
    const requests = Array.from({ length: 40 }, (_, i) => ({ id: `r${i}`, from: person(`p${i}`), message: '', createdAt: iso(2026, 10, 1 + (i % 13)) }));
    assert.equal(buildNotifications({ now: NOW, requests }).length, MAX_NOTIFICATIONS);
  });
});

describe('countNew', () => {
  test('counts what came after the bell was last opened', () => {
    const items = [{ at: 10 }, { at: 20 }, { at: 30 }];
    assert.equal(countNew(items, 0), 3);
    assert.equal(countNew(items, 20), 1);
    assert.equal(countNew(items, 30), 0);
  });
});

describe('court booking in the bell', () => {
  const booking = (extra = {}) => ({
    id: 'bk1', courtName: 'Tennis 2', locationName: 'Janus-Areena', startsAt: iso(2026, 10, 15, 18), endsAt: iso(2026, 10, 15, 19),
    createdAt: iso(2026, 10, 14, 9), priceCents: 3000, paymentStatus: 'paid', soldAt: null, split: null, ...extra,
  });
  const share = (extra = {}) => ({
    id: 's1', kind: 'friend', cents: 1500, status: 'pending', payable: true, deadline: iso(2026, 10, 15, 16), chargeError: null,
    booker: person('b', 'Mikko Mallikas'), booking: booking(), ...extra,
  });

  test('a friend\'s request to pay my share, and a rest my card did not cover, open the share', () => {
    const items = buildNotifications({
      uid: 'me', now: NOW,
      shares: [share(), share({ id: 's2', kind: 'rest', booker: person('me', 'Minä'), deadline: iso(2026, 10, 13, 16), chargeError: 'card_declined' })],
    });
    const byKind = Object.fromEntries(items.map((i) => [i.kind, i]));
    assert.equal(byKind.share.title, 'Mikko pyytää osuuttasi kenttävuorosta');
    assert.equal(byKind.share.body, '15 € · Huomenna klo 18.00 · Janus-Areena');
    assert.equal(byKind.share.to, '/pelaa/osuus/s1');
    assert.equal(byKind.share.person.name, 'Mikko Mallikas');
    assert.equal(byKind.rest.title, 'Loppuosuus maksamatta: 15 €');
    assert.equal(byKind.rest.to, '/pelaa/osuus/s2');
    assert.equal(byKind.rest.at, local(2026, 10, 13, 16).getTime());
  });

  test('only payable shares count; a sold booking of the last week says what comes back', () => {
    const items = buildNotifications({
      uid: 'me', now: NOW,
      shares: [share({ payable: false, status: 'paid' })],
      bookings: [
        booking({ soldAt: iso(2026, 10, 14, 10), status: 'cancelled', paymentStatus: 'refunded' }),
        booking({ id: 'old', soldAt: iso(2026, 10, 1, 10) }),
        booking({ id: 'plain', status: 'cancelled' }),
      ],
    });
    assert.deepEqual(items.map((i) => [i.kind, i.id]), [['sold', 'sold:bk1']]);
    assert.equal(items[0].title, 'Vuorosi myytiin');
    assert.equal(items[0].body, '30 € palautetaan · Huomenna klo 18.00 · Tennis 2');
    assert.equal(items[0].to, '/pelaa/varaa');
  });
});
