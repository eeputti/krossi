// resultLinks.js — logged match results whose players are Krossi users, and the opponent's
// confirmation (groundwork for a future player rating; no rating is computed here).
//
// Pure functions shared by both backends and the UI. A stored result is written from its
// creator's point of view: sets are { my, opp } for the creator, and the people sit in four
// slots — creator, partner (creator's side), opponent and oppPartner (the other side). Any
// slot but the creator may be a typed name only. viewResult() turns that into the MatchResult
// a given player sees: their own side is "my", whoever logged it.
//
// StoredResult (camelCase row; api/supabase/map.js mapStoredResult, demo db.results):
//   { id, createdAt, createdBy, gameType, format, partnerName, opponentName, oppPartnerName,
//     partnerId, opponentId, oppPartnerId, sets: {my, opp}[], won,
//     confirmation: null|'pending'|'confirmed'|'disputed', confirmedBy, confirmedAt, disputedBy, disputedAt }

const UNKNOWN = 'Pelaaja';

const num = (n) => Number(n) || 0;
const known = (person) => (person && person.name && person.name !== UNKNOWN ? person : null);
const lite = (p) => (p ? {
  id: p.id, name: p.name, avatarUrl: p.avatarUrl ?? null, avatarColor: p.avatarColor || 'blue',
  ageRange: p.ageRange ?? null, skillLevel: p.skillLevel ?? null,
} : null);

/** More sets won than lost, from the side whose games are `my`. */
export function setsWonBy(sets) {
  const list = Array.isArray(sets) ? sets : [];
  return list.filter((s) => num(s.my) > num(s.opp)).length > list.filter((s) => num(s.opp) > num(s.my)).length;
}

/** 'creator' | 'partner' | 'opponent' | 'oppPartner' | null — where `uid` sits in the result. */
export function roleOf(row, uid) {
  if (!uid || !row) return null;
  if (row.createdBy === uid) return 'creator';
  if (row.partnerId === uid) return 'partner';
  if (row.opponentId === uid) return 'opponent';
  if (row.oppPartnerId === uid) return 'oppPartner';
  return null;
}

/** Only the other side answers: the opponent, or in doubles the opponent's partner. */
export const canAnswer = (row, uid) => ['opponent', 'oppPartner'].includes(roleOf(row, uid));

/**
 * The linked ids of a result being saved (MatchResultInput), normalised the same way by both
 * backends: '' is null and singles have no partners. `error` is a Finnish message when the same
 * person is in two roles or I named myself (the database refuses those too).
 * -> { ids: { partnerId, opponentId, oppPartnerId }, error: string|null }
 */
export function linksOfInput(input, uid) {
  const doubles = input?.format === 'doubles';
  const id = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);
  const ids = {
    partnerId: doubles ? id(input?.partnerId) : null,
    opponentId: id(input?.opponentId),
    oppPartnerId: doubles ? id(input?.oppPartnerId) : null,
  };
  const list = Object.values(ids).filter(Boolean);
  if (uid && list.includes(uid)) return { ids, error: 'Et voi merkitä itseäsi tulokseen vastustajaksi tai pariksi.' };
  if (new Set(list).size !== list.length) return { ids, error: 'Sama pelaaja ei voi olla tuloksessa kahdesti.' };
  return { ids, error: null };
}

/** Did saving `after` put a new question to the other side (so they should be told)? */
export function asksOpponent(before, after) {
  if (after?.confirmation !== 'pending') return false;
  if (!before || before.confirmation !== 'pending') return true;
  return before.opponentId !== after.opponentId || before.oppPartnerId !== after.oppPartnerId;
}

/**
 * Stored result -> MatchResult as `viewerId` sees it.
 * `people`: Map | object of id -> PersonLite for the linked ids and the creator (unknown ids
 * become 'Pelaaja'). Typed names win for display; a linked person fills in an empty name.
 */
export function viewResult(row, viewerId, people = new Map()) {
  const get = (id) => (id ? (people instanceof Map ? people.get(id) : people[id]) || { id, name: UNKNOWN, avatarUrl: null, avatarColor: 'blue' } : null);
  const slot = (id, typed) => {
    const person = get(id);
    const name = String(typed || '').trim() || known(person)?.name || null;
    return { person: lite(person), name };
  };
  const creator = slot(row.createdBy, null);
  const partner = slot(row.partnerId, row.partnerName);
  const opponent = slot(row.opponentId, row.opponentName);
  const oppPartner = slot(row.oppPartnerId, row.oppPartnerName);

  const role = roleOf(row, viewerId) || 'creator';
  const flip = role === 'opponent' || role === 'oppPartner';
  const view = {
    creator: { partner, opponent, oppPartner },
    partner: { partner: creator, opponent, oppPartner },
    opponent: { partner: oppPartner, opponent: creator, oppPartner: partner },
    oppPartner: { partner: opponent, opponent: creator, oppPartner: partner },
  }[role];
  const doubles = row.format === 'doubles';
  const sets = (Array.isArray(row.sets) ? row.sets : []).map((s) => (flip ? { my: num(s.opp), opp: num(s.my) } : { my: num(s.my), opp: num(s.opp) }));
  const answeredBy = row.confirmation === 'confirmed' ? row.confirmedBy : row.confirmation === 'disputed' ? row.disputedBy : null;
  const answeredAt = row.confirmation === 'confirmed' ? row.confirmedAt : row.confirmation === 'disputed' ? row.disputedAt : null;
  const isMine = role === 'creator';

  return {
    id: row.id,
    createdAt: row.createdAt,
    gameType: row.gameType,
    format: row.format,
    partnerName: doubles ? view.partner.name : null,
    opponentName: view.opponent.name,
    oppPartnerName: doubles ? view.oppPartner.name : null,
    sets,
    won: flip ? setsWonBy(sets) : Boolean(row.won),
    partner: doubles ? view.partner.person : null,
    opponent: view.opponent.person,
    oppPartner: doubles ? view.oppPartner.person : null,
    confirmation: row.confirmation ?? null,
    answeredBy: answeredBy ? lite(get(answeredBy)) : null,
    answeredAt: answeredAt ?? null,
    isMine,
    loggedBy: isMine ? null : creator.person,
  };
}

/**
 * Who to offer in the opponent picker: pelikaverit first (most games together), then the other
 * players in their given order. Unknown names ('Pelaaja': no profile access), `excludeIds` and
 * duplicates drop out; `query` matches the start of any word of the name.
 *   partners: Partner[]   players: (Profile|PersonLite)[]
 * -> { person: PersonLite, gamesTogether: number }[]  at most `limit`
 */
export function rankCandidates({ partners = [], players = [], query = '', excludeIds = [], limit = 8 } = {}) {
  const q = String(query || '').trim().toLocaleLowerCase('fi');
  const skip = new Set(excludeIds.filter(Boolean));
  const matches = (name) => !q || name.toLocaleLowerCase('fi').split(/[\s-]+/).some((word) => word.startsWith(q))
    || name.toLocaleLowerCase('fi').startsWith(q);
  const out = [];
  const add = (person, gamesTogether) => {
    if (!known(person) || skip.has(person.id) || !matches(person.name)) return;
    skip.add(person.id);
    out.push({ person: lite(person), gamesTogether });
  };
  for (const p of partners) add(p.player, p.gamesTogether || 0);
  for (const p of players) add(p, 0);
  return out.slice(0, limit);
}

/** Linked Krossi players of a MatchResult as I see it (opponents first). */
export function opponentIdsOf(result) {
  return [result?.opponent?.id, result?.oppPartner?.id].filter(Boolean);
}

/**
 * The matches a rating may use, from my point of view: logged results that an opponent has
 * confirmed and whose other side has at least one Krossi player, plus confirmed league
 * matches (Activity.leagueMatches; walkovers are never in it). A match both logged as a
 * result and played in a league on the same day with the same score counts once (league kept).
 *   -> { id, source: 'league'|'result', playedAt, format, partnerId, opponentIds, sets: {a, b}[], winner: 'a'|'b'|null }[]
 *      a = my side; newest first
 */
export function ratedMatches({ results = [], leagueMatches = [] } = {}) {
  const tallyWinner = (sets) => {
    const a = sets.filter((s) => s.a > s.b).length;
    const b = sets.filter((s) => s.b > s.a).length;
    return a > b ? 'a' : b > a ? 'b' : null;
  };
  const league = leagueMatches
    .filter((m) => m.opponent?.id)
    .map((m) => {
      const sets = (m.sets || []).map((s) => ({ a: num(s.a), b: num(s.b) }));
      // `won` is the league's own verdict; level games (a timed draw) are nobody's win.
      const winner = m.won ? 'a' : tallyWinner(sets) === null ? null : 'b';
      return { id: m.id, source: 'league', playedAt: m.playedAt, format: 'singles', partnerId: null, opponentIds: [m.opponent.id], sets, winner };
    });
  const logged = results
    .filter((r) => r.confirmation === 'confirmed' && opponentIdsOf(r).length > 0)
    .map((r) => {
      const sets = (r.sets || []).map((s) => ({ a: num(s.my), b: num(s.opp) }));
      return {
        id: r.id, source: 'result', playedAt: r.createdAt, format: r.format, partnerId: r.partner?.id ?? null,
        opponentIds: opponentIdsOf(r), sets, winner: tallyWinner(sets),
      };
    });
  const seen = new Set();
  const keyOf = (m) => `${String(m.playedAt || '').slice(0, 10)}|${[...m.opponentIds].sort().join(',')}|${m.sets.map((s) => `${s.a}-${s.b}`).join(' ')}`;
  return [...league, ...logged]
    .filter((m) => {
      const key = keyOf(m);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((x, y) => String(y.playedAt || '').localeCompare(String(x.playedAt || '')));
}
