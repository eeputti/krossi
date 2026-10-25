// groupLinks.js — "kauden ryhmälinkki": one join link per group that works for the whole season,
// shared once (myClub's notice, the group's WhatsApp, a QR code at the first session) instead of a
// personal link per player. The codes are the existing group invite codes
// (create_koutsi_invite_code); the server caps them at 180 days and 100 uses, which covers a
// season and any group. Minors still join with their own personal link (enforced server-side).
import { koutsiAddDays, koutsiDateFromStr, koutsiFmtShortDate, koutsiInviteLink, koutsiTodayStr } from './core.js';

export const SEASON_LINK_USES = 100;
const MAX_DAYS = 180;

const daysBetween = (a, b) => Math.round((koutsiDateFromStr(b) - koutsiDateFromStr(a)) / 86400000);

/** How long a season link lasts: to a week after the season's end (at most 180 days, the server's cap). */
export function seasonLinkDays(season, today = koutsiTodayStr()) {
  if (!season?.endsOn || season.endsOn < today) return 120;
  return Math.max(1, Math.min(MAX_DAYS, daysBetween(today, koutsiAddDays(season.endsOn, 7))));
}

/** A code made as a season link: for a group, for the whole group (100 uses), still usable. */
export function isSeasonLink(code) {
  return Boolean(code && code.groupId && code.active && (code.maxUses == null || code.maxUses >= SEASON_LINK_USES));
}

/** The group's season link from the coach's codes (the newest), or null. */
export function seasonLinkFor(codes, groupId) {
  return (codes || [])
    .filter((c) => c.groupId === groupId && isSeasonLink(c))
    .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))[0] || null;
}

/** How many of the group's players have their own account: { joined, total }. */
export function joinedCount(state, group) {
  const ids = group?.memberIds || [];
  const joined = ids.filter((id) => {
    const s = state.students.find((x) => x.id === id);
    return s && !s.isPlaceholder;
  }).length;
  return { joined, total: ids.length };
}

/** Players across groups, each counted once (a player can be in several groups): { joined, total }. */
export function joinedTotals(state, groups) {
  const ids = new Set((groups || []).flatMap((g) => g.memberIds || []));
  return joinedCount(state, { memberIds: [...ids] });
}

/**
 * One message for every group: the season (when it starts), then each group's time, name and link.
 *   rows: [{ group: { day, time, name }, code }]
 */
export function groupLinksMessage({ coachName, season, rows, today = koutsiTodayStr() }) {
  const who = coachName ? `${coachName.split(' ')[0]} täällä! ` : '';
  const when = season?.name
    ? (season.startsOn > today ? `${season.name} alkaa ${koutsiFmtShortDate(season.startsOn)} ` : `${season.name} on käynnissä. `)
    : '';
  const lead = `${who}${when}Liity Krossi Koutsiin oman ryhmäsi linkillä — näet treenien ajat, viikon teeman ja oman kehityksesi. Ikää ei tarvitse ilmoittaa, eikä Koutsiin kirjata terveystietoja.`;
  const list = rows.filter((r) => r.code).map((r) => `${r.group.day} ${r.group.time} · ${r.group.name}\n${koutsiInviteLink(r.code)}`);
  return [lead, ...list, 'Alaikäiset liittyvät valmentajan lähettämällä henkilökohtaisella linkillä.'].join('\n\n');
}
