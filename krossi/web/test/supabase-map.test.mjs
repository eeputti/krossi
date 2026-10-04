// Row -> shape rules of the real backend (src/api/supabase/map.js). These encode production
// data conventions shared with the mobile app, so a regression here corrupts real profiles.
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  parseSkill, serializeSkill, parsePlayStyles, parseAreas, mapPerson, mapProfile, gameCapacity, gameIsPast,
  mapGame, parseMessageContent, lastMessagePreview, leagueSetsFor, leagueSetsToStored, avatarUrl,
} from '../src/api/supabase/map.js';

test('parseSkill understands every stored skill_level format', () => {
  assert.deepEqual(parseSkill('keskitaso'), { skillLevel: 'keskitaso', competitionClasses: [] });
  assert.deepEqual(parseSkill('kilpapelaaja,B2,B1'), { skillLevel: 'kilpapelaaja', competitionClasses: ['B1', 'B2'] });
  assert.deepEqual(parseSkill('B2'), { skillLevel: 'kilpapelaaja', competitionClasses: ['B2'] });
  assert.deepEqual(parseSkill('rento'), { skillLevel: 'keskitaso', competitionClasses: [] });
  assert.deepEqual(parseSkill(null), { skillLevel: 'keskitaso', competitionClasses: [] });
  assert.deepEqual(parseSkill('edistynyt,B2'), { skillLevel: 'edistynyt', competitionClasses: [] });
});

test('serializeSkill writes classes only for kilpapelaaja', () => {
  assert.equal(serializeSkill('kilpapelaaja', ['B1', 'B2']), 'kilpapelaaja,B1,B2');
  assert.equal(serializeSkill('aloittelija', ['B1']), 'aloittelija');
  assert.equal(serializeSkill('kilpapelaaja', []), 'kilpapelaaja');
});

test('list columns parse like the legacy app', () => {
  assert.deepEqual(parsePlayStyles('matsit, nelinpeli'), ['matsit', 'nelinpeli']);
  assert.deepEqual(parsePlayStyles(''), ['kaikki käy']);
  assert.deepEqual(parseAreas('Lahti, Helsinki,  Lahti'), ['Lahti', 'Helsinki']);
});

test('unreadable profiles still map to a person', () => {
  assert.deepEqual(mapPerson(null, 'u1'), { id: 'u1', name: 'Pelaaja', avatarUrl: null, avatarColor: 'blue', ageRange: null, skillLevel: null });
  const p = mapPerson({ id: 'u2', name: ' Eelis ', avatar_url: 'u2/1.jpg', avatar_color: 'lime', tennis_preferences: { skill_level: 'B2' } });
  assert.equal(p.name, 'Eelis');
  assert.equal(p.avatarColor, 'blue');
  assert.equal(p.skillLevel, 'kilpapelaaja');
  assert.match(p.avatarUrl, /\/storage\/v1\/object\/public\/profile-avatars\/u2\/1\.jpg$/);
  assert.equal(avatarUrl('https://x.test/a.jpg?t=1'), 'https://x.test/a.jpg?t=1');
});

test('mapProfile', () => {
  const profile = mapProfile({
    id: 'me', name: 'Eelis', age: '30-40', gender: 'mies', area: 'Lahti, Turku', bio: '  ', avatar_url: null,
    avatar_color: 'green', playing_this_week: true, hidden_from_feed: false, paid_at: null, created_at: '2026-01-01',
    tennis_preferences: [{ skill_level: 'kilpapelaaja,C1', play_style: 'matsit', handedness: 'vasenkätinen', backhand_type: null }],
    availability: [{ slot: 'arki-illat' }],
  });
  assert.equal(profile.city, 'Lahti');
  assert.deepEqual(profile.areas, ['Lahti', 'Turku']);
  assert.equal(profile.bio, null);
  assert.deepEqual(profile.competitionClasses, ['C1']);
  assert.deepEqual(profile.availability, ['arki-illat']);
  assert.equal(profile.handedness, 'vasenkätinen');
});

test('capacity follows the join_challenge RPC', () => {
  assert.equal(gameCapacity('kaksinpeli', null), 1);
  assert.equal(gameCapacity('nelinpeli', null), 3);
  assert.equal(gameCapacity('kaksinpeli', 8), 7);
  assert.equal(gameCapacity('nelinpeli', 2), 3);
});

test('gameIsPast prefers expires_at, then scheduled_at', () => {
  const now = '2026-10-02T12:00:00.000Z';
  assert.equal(gameIsPast({ expires_at: '2026-10-02T11:00:00Z', scheduled_at: null }, now), true);
  assert.equal(gameIsPast({ expires_at: null, scheduled_at: '2026-10-03T11:00:00Z' }, now), false);
  assert.equal(gameIsPast({ expires_at: null, scheduled_at: null }, now), false);
});

test('mapGame counts participants whose profile is hidden', () => {
  const game = mapGame(
    { id: 'g', creator_id: 'c', match_type: 'nelinpeli', status: 'open', challenge_type: 'open', location: '', created_at: 'x' },
    { uid: 'me', creator: null, participants: [{ userId: 'me', row: null }, { userId: 'p2', row: null }], waitlistUserIds: ['w1'] },
  );
  assert.equal(game.spotsLeft, 1);
  assert.equal(game.iJoined, true);
  assert.equal(game.isMine, false);
  assert.equal(game.onWaitlist, false);
  assert.equal(game.waitlistCount, 1);
  assert.equal(game.locationName, 'Avoin');
  assert.equal(game.creator.name, 'Pelaaja');
});

test('message content conventions', () => {
  assert.equal(parseMessageContent('{"__type":"thumbs_up"}', null).kind, 'thumbs');
  const join = parseMessageContent(JSON.stringify({ __type: 'challenge_join', joinerName: 'Anni', joinerAvatarUrl: 'a/b.jpg' }), null);
  assert.equal(join.kind, 'join');
  assert.equal(join.text, 'Anni liittyi peliin!');
  assert.match(join.meta.joinerAvatarUrl, /profile-avatars\/a\/b\.jpg$/);
  const image = parseMessageContent(null, 'me/1-x.jpg');
  assert.equal(image.kind, 'image');
  assert.match(image.imageUrl, /chat-images\/me\/1-x\.jpg$/);
  assert.deepEqual(parseMessageContent('{ei json', null), { kind: 'text', text: '{ei json', imageUrl: null, meta: null });
  assert.equal(lastMessagePreview(null, { hasImage: true }).text, '📷 Kuva');
  assert.equal(lastMessagePreview(null), null);
});

test('league sets round-trip between reporter-relative storage and player A orientation', () => {
  const fixture = { player_a_id: 'A', player_b_id: 'B' };
  const asA = [{ a: 6, b: 3 }, { a: 4, b: 6 }];
  const storedByB = leagueSetsToStored(asA, fixture, 'B');
  assert.deepEqual(storedByB, [{ my: 3, opp: 6 }, { my: 6, opp: 4 }]);
  assert.deepEqual(leagueSetsFor({ reported_by: 'B', sets: storedByB }, 'A'), asA);
  assert.deepEqual(leagueSetsFor({ reported_by: 'A', sets: leagueSetsToStored(asA, fixture, 'A') }, 'A'), asA);
});

test('the backend can be imported without a browser', async () => {
  const { backend } = await import('../src/api/supabase/index.js');
  assert.equal(typeof backend.games.listOpen, 'function');
});
