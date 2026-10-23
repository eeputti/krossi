// season.js — tennis seasons ("Syksy 2026", "Kevät 2027") and the "Uusi kausi" draft.
//
// A season has a start, an end and break days (hiihtoloma, pääsiäinen …). Its groups are rows of
// their own, so the season that ends keeps its sessions, attendance and themes untouched. The next
// season starts as a copy of the current one: every group continues with the same players, and the
// coach only marks what changes (a new time, a group that ends, a player who moves up).
//
//   Season  { id, name, startsOn, endsOn, breaks: Break[] }
//   Break   { key, label, from, to, on }                       dates inclusive
//   Draft   { name, startsOn, endsOn, breaks, fromSeasonId,
//             groups: DraftGroup[], members: { [groupKey]: playerRef[] }, newPlayers: [{ key, name }] }
//   DraftGroup { key, fromId | null, name, level, day, time, durationMinutes, status }
//              status: 'jatkuu' | 'muuttuu' | 'loppuu' | 'uusi'
//   playerRef = an existing student id, or a newPlayers key ("uusi-…")
import {
  koutsiAddDays, koutsiDateFromStr, koutsiIsoWeekStart, koutsiNextWeekday, koutsiSortGroupsBySchedule,
  koutsiTodayStr, koutsiWeeklyDates,
} from './core.js';

const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const isoMonday = (year, week) => ymd(koutsiIsoWeekStart(year, week));
const daysBetween = (a, b) => Math.round((koutsiDateFromStr(b) - koutsiDateFromStr(a)) / 86400000);

export const SEASON_LABELS = { syksy: 'Syksy', kevat: 'Kevät', kesa: 'Kesä' };

/** Which season a date belongs to: syksy (Aug–Dec), kevät (Jan–May), kesä (Jun–Jul). */
export function seasonKind(dateStr) {
  const m = Number(String(dateStr).slice(5, 7));
  if (m >= 8) return 'syksy';
  if (m <= 5) return 'kevat';
  return 'kesa';
}

export function seasonName(startsOn) {
  return `${SEASON_LABELS[seasonKind(startsOn)]} ${String(startsOn).slice(0, 4)}`;
}

/** "kevät" / "kevään" / "keväällä" — for sentences like "Suunnittele kevät", "Ei jatka keväällä". */
const FORMS = {
  syksy: { base: 'syksy', gen: 'syksyn', ade: 'syksyllä' },
  kevat: { base: 'kevät', gen: 'kevään', ade: 'keväällä' },
  kesa: { base: 'kesä', gen: 'kesän', ade: 'kesällä' },
};
export function seasonWord(startsOn, form = 'base') {
  return FORMS[seasonKind(startsOn)][form];
}

/** Easter Sunday (Gregorian calendar, the anonymous algorithm) as YYYY-MM-DD. */
export function easterSunday(year) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return `${year}-${pad(month)}-${pad(day)}`;
}

const brk = (key, label, from, to = from) => ({ key, label, from, to, on: true });

/**
 * Suggested break days for a season. The coach switches them on or off; nothing here is a rule.
 * Hiihtoloma is week 9 (Lahti and most of central Finland); the coach can switch it off.
 */
export function suggestedBreaks(startsOn, endsOn) {
  const year = Number(startsOn.slice(0, 4));
  const kind = seasonKind(startsOn);
  const list = [];
  if (kind === 'kevat') {
    const easter = easterSunday(year);
    list.push(brk('hiihtoloma', 'Hiihtoloma', isoMonday(year, 9), koutsiAddDays(isoMonday(year, 9), 6)));
    list.push(brk('paasiainen', 'Pääsiäinen', koutsiAddDays(easter, -2), koutsiAddDays(easter, 1)));
    list.push(brk('vappu', 'Vappu', `${year}-05-01`));
    list.push(brk('helatorstai', 'Helatorstai', koutsiAddDays(easter, 39)));
  } else if (kind === 'syksy') {
    list.push(brk('syysloma', 'Syysloma', isoMonday(year, 42), koutsiAddDays(isoMonday(year, 42), 6)));
    list.push(brk('itsenaisyyspaiva', 'Itsenäisyyspäivä', `${year}-12-06`));
  } else {
    const eve = koutsiNextWeekday(`${year}-06-19`, 'pe'); // juhannusaatto: the Friday of 19.–25.6.
    list.push(brk('juhannus', 'Juhannus', eve, koutsiAddDays(eve, 2)));
  }
  return list.filter((b) => b.to >= startsOn && b.from <= endsOn);
}

/**
 * The season after `current`: autumn → spring (ISO weeks 2–20), spring or summer → autumn
 * (weeks 35–50). Only a starting point — every field stays editable.
 */
export function nextSeasonPreset(current, today = koutsiTodayStr()) {
  const after = current?.endsOn || today;
  const year = Number(after.slice(0, 4));
  let startsOn;
  let endsOn;
  if (seasonKind(after) === 'syksy') {
    startsOn = isoMonday(year + 1, 2);
    endsOn = koutsiAddDays(isoMonday(year + 1, 20), 6);
  } else {
    startsOn = isoMonday(year, 35);
    endsOn = koutsiAddDays(isoMonday(year, 50), 6);
  }
  return { name: seasonName(startsOn), startsOn, endsOn, breaks: suggestedBreaks(startsOn, endsOn) };
}

/** Every date the season's breaks cover (only breaks that are on). */
export function breakDates(breaks) {
  const out = new Set();
  for (const b of breaks || []) {
    if (!b.on) continue;
    for (let d = b.from; d <= b.to; d = koutsiAddDays(d, 1)) out.add(d);
  }
  return out;
}

/** The weekly dates of a slot ({ day }) inside the season, break days left out. */
export function seasonDates(slot, season) {
  const first = koutsiNextWeekday(season.startsOn, slot.day);
  if (!first || !season.endsOn || first > season.endsOn) return [];
  const skip = breakDates(season.breaks);
  return koutsiWeeklyDates(first, season.endsOn, 60).filter((d) => !skip.has(d));
}

/** Weeks the season spans, for "20 viikkoa". */
export function seasonWeeks(season) {
  if (!season?.startsOn || !season?.endsOn || season.endsOn < season.startsOn) return 0;
  return Math.ceil((daysBetween(season.startsOn, season.endsOn) + 1) / 7);
}

/** "8.–14.3." / "26.3.–29.3." / "1.5." */
export function rangeLabel(from, to) {
  const a = koutsiDateFromStr(from);
  const b = koutsiDateFromStr(to || from);
  if (from === (to || from)) return `${a.getDate()}.${a.getMonth() + 1}.`;
  if (a.getMonth() === b.getMonth()) return `${a.getDate()}.–${b.getDate()}.${b.getMonth() + 1}.`;
  return `${a.getDate()}.${a.getMonth() + 1}.–${b.getDate()}.${b.getMonth() + 1}.`;
}

// ── seasons in the coach's state ─────────────────────────────────────────────

const byStart = (a, b) => String(a.startsOn).localeCompare(String(b.startsOn));

/** The season running today, else the latest that has started, else the first one coming. */
export function currentSeason(state, today = koutsiTodayStr()) {
  const seasons = [...(state.seasons || [])].sort(byStart);
  if (!seasons.length) return null;
  return seasons.find((s) => s.startsOn <= today && today <= s.endsOn)
    || [...seasons].reverse().find((s) => s.startsOn <= today)
    || seasons[0];
}

/** A season published after `season` (the one the coach already set up), or null. */
export function followingSeason(state, season) {
  if (!season) return null;
  return [...(state.seasons || [])].sort(byStart).find((s) => s.id !== season.id && s.startsOn > season.startsOn) || null;
}

export function groupsOfSeason(state, season) {
  if (!season) return [];
  return koutsiSortGroupsBySchedule(state.groups.filter((g) => g.seasonId === season.id));
}

/**
 * What Koti says about seasons: nothing until the current season ends within `withinDays`;
 * then "plan the next one", "your draft is waiting" or "the next one is published".
 */
export function seasonNudge(state, today = koutsiTodayStr(), withinDays = 56) {
  if (!state.seasonsReady) return null;
  const season = currentSeason(state, today);
  if (!season || season.endsOn < today) return null;
  const daysLeft = daysBetween(today, season.endsOn);
  if (daysLeft > withinDays) return null;
  const next = followingSeason(state, season);
  const draft = state.seasonDraft && state.seasonDraft.fromSeasonId === season.id ? state.seasonDraft : null;
  return { season, daysLeft, next, draft, kind: next ? 'published' : draft ? 'draft' : 'plan' };
}

// ── the draft ────────────────────────────────────────────────────────────────

/** The next season as a copy of `season`: every group continues with the same players. */
export function draftFromSeason(state, season, preset = nextSeasonPreset(season)) {
  const groups = groupsOfSeason(state, season).map((g) => ({
    key: `k-${g.id}`, fromId: g.id, name: g.name, level: g.level || '', day: g.day, time: g.time,
    durationMinutes: g.durationMinutes || 60, status: 'jatkuu',
  }));
  const members = Object.fromEntries(groups.map((dg) => [dg.key, [...(state.groups.find((g) => g.id === dg.fromId)?.memberIds || [])]]));
  return { ...preset, fromSeasonId: season?.id || null, groups, members, newPlayers: [] };
}

export const isActive = (dg) => dg.status !== 'loppuu';

/** The draft's groups that run in the new season, in schedule order. */
export function activeGroups(draft) {
  return koutsiSortGroupsBySchedule(draft.groups.filter(isActive));
}

/** Draft groups (active) a player is in. */
export function placementsOf(draft, ref) {
  return activeGroups(draft).filter((dg) => (draft.members[dg.key] || []).includes(ref));
}

/** Moves a player: `keys` = the active draft groups the player plays in next season (may be empty). */
export function placePlayer(draft, ref, keys) {
  const want = new Set(keys);
  const members = {};
  for (const dg of draft.groups) {
    const list = (draft.members[dg.key] || []).filter((x) => x !== ref);
    members[dg.key] = isActive(dg) && want.has(dg.key) ? [...list, ref] : list;
  }
  return { ...draft, members };
}

/** Changes one draft group (status or fields). */
export function updateDraftGroup(draft, key, patch) {
  return { ...draft, groups: draft.groups.map((dg) => (dg.key === key ? { ...dg, ...patch } : dg)) };
}

let newSeq = 0;
export function addDraftGroup(draft, fields) {
  const key = `uusi-g-${Date.now().toString(36)}-${(newSeq += 1)}`;
  return {
    ...draft,
    groups: [...draft.groups, { key, fromId: null, status: 'uusi', level: '', durationMinutes: 60, ...fields }],
    members: { ...draft.members, [key]: [] },
  };
}

/** Adds pasted names: existing players (exact name) keep their id, others become new players. */
export function addSignups(draft, rows) {
  let next = { ...draft, newPlayers: [...draft.newPlayers], members: { ...draft.members } };
  for (const { name, existingId, groupKey } of rows) {
    let ref = existingId;
    if (!ref) {
      const known = next.newPlayers.find((p) => p.name.toLowerCase() === name.toLowerCase());
      ref = known ? known.key : `uusi-p-${Date.now().toString(36)}-${(newSeq += 1)}`;
      if (!known) next.newPlayers.push({ key: ref, name });
    }
    if (groupKey && !(next.members[groupKey] || []).includes(ref)) next.members[groupKey] = [...(next.members[groupKey] || []), ref];
  }
  return next;
}

export const scheduleChanged = (dg, group) => Boolean(group) && (dg.day !== group.day || dg.time !== group.time
  || (dg.durationMinutes || 60) !== (group.durationMinutes || 60));

/**
 * Everything the review step and the publish need, counted once:
 * groups (continuing / changed / ended / new), sessions, players (continuing / moved / new /
 * not continuing) and who still has no account.
 */
export function draftSummary(state, draft) {
  const season = { startsOn: draft.startsOn, endsOn: draft.endsOn, breaks: draft.breaks };
  const active = activeGroups(draft);
  const groupById = (id) => state.groups.find((g) => g.id === id) || null;
  const studentById = (id) => state.students.find((s) => s.id === id) || null;
  const before = new Map(); // student id → Set(old group ids)
  for (const dg of draft.groups) {
    if (!dg.fromId) continue;
    for (const id of groupById(dg.fromId)?.memberIds || []) {
      if (!before.has(id)) before.set(id, new Set());
      before.get(id).add(dg.fromId);
    }
  }
  const refs = new Set(active.flatMap((dg) => draft.members[dg.key] || []));
  const endedFrom = new Set(draft.groups.filter((dg) => dg.status === 'loppuu' && dg.fromId).map((dg) => dg.fromId));
  const moved = [];
  const staying = [];
  for (const ref of refs) {
    if (!before.has(ref)) continue;
    const old = before.get(ref);
    const now = placementsOf(draft, ref);
    const fresh = now.filter((dg) => !dg.fromId || !old.has(dg.fromId));
    // leaving a group that ends is not a move (the group's own line says it); leaving one that
    // continues is
    const left = [...old].filter((id) => !now.some((dg) => dg.fromId === id) && !endedFrom.has(id));
    if (fresh.length || left.length) {
      moved.push({ student: studentById(ref), from: [...old].map(groupById).filter(Boolean), to: now });
    } else staying.push(ref);
  }
  const leaving = [...before.keys()].filter((id) => !refs.has(id)).map(studentById).filter(Boolean)
    .sort((a, b) => a.name.localeCompare(b.name, 'fi'));
  const newPlayers = draft.newPlayers.filter((p) => refs.has(p.key));
  const existingIn = [...refs].map(studentById).filter(Boolean);
  const unplacedNew = draft.newPlayers.filter((p) => !refs.has(p.key));
  const sessions = active.reduce((n, dg) => n + seasonDates(dg, season).length, 0);
  return {
    weeks: seasonWeeks(season),
    sessions,
    groups: {
      active,
      continuing: active.filter((dg) => dg.status === 'jatkuu'),
      changed: active.filter((dg) => dg.status === 'muuttuu'),
      ended: draft.groups.filter((dg) => dg.status === 'loppuu'),
      added: active.filter((dg) => dg.status === 'uusi'),
    },
    players: {
      total: refs.size,
      staying: staying.length,
      moved: moved.sort((a, b) => (a.student?.name || '').localeCompare(b.student?.name || '', 'fi')),
      leaving,
      newPlayers,
      unplacedNew,
      noAccount: existingIn.filter((s) => s.isPlaceholder).length + newPlayers.length,
    },
    changes: draft.groups.filter((dg) => dg.status !== 'jatkuu').length + moved.length + leaving.length + newPlayers.length,
  };
}

/** One player's notification at publish: "Kevät 2027 alkaa ma 11.1.: Ti klo 17.00 Aikuiset edistyneet …". */
export function playerSeasonMessage(draft, groups, fmtDate) {
  const list = groups.map((dg) => `${dg.day} klo ${String(dg.time || '').replace(':', '.')} ${dg.name}`);
  const joined = list.length > 1 ? `${list.slice(0, -1).join(', ')} ja ${list[list.length - 1]}` : list[0] || '';
  return `${draft.name} alkaa ${fmtDate(draft.startsOn)}: ${joined}.`;
}
