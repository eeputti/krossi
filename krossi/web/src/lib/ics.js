// ics.js — "Lisää kalenteriin": builds an .ics file for a game and downloads it.
import { labelOf, MATCH_TYPES, GAME_DURATION_HOURS } from './constants.js';

const stamp = (d) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
const esc = (s) => String(s || '').replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/[,;]/g, (m) => `\\${m}`);

/** Returns the iCalendar text for a Game (contract shape). Null when the game has no time. */
export function buildIcs(game, url) {
  if (!game?.scheduledAt) return null;
  const start = new Date(game.scheduledAt);
  const end = new Date(start.getTime() + Math.min(GAME_DURATION_HOURS, 2) * 3_600_000);
  const what = game.title || `${labelOf(MATCH_TYPES, game.matchType) || 'Tennis'} – Krossi`;
  const who = [game.creator?.name, ...(game.participants || []).map((p) => p.name)].filter(Boolean).join(', ');
  return [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Krossi//krossi.app//FI', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${game.id}@krossi.app`,
    `DTSTAMP:${stamp(new Date())}`,
    `DTSTART:${stamp(start)}`,
    `DTEND:${stamp(end)}`,
    `SUMMARY:${esc(`🎾 ${what}`)}`,
    `LOCATION:${esc([game.locationName, game.city].filter(Boolean).join(', '))}`,
    `DESCRIPTION:${esc([who && `Pelaajat: ${who}`, game.description, url].filter(Boolean).join('\n'))}`,
    url ? `URL:${url}` : null,
    'BEGIN:VALARM', 'TRIGGER:-PT2H', 'ACTION:DISPLAY', 'DESCRIPTION:Tennispeli kahden tunnin päästä', 'END:VALARM',
    'END:VEVENT', 'END:VCALENDAR',
  ].filter(Boolean).join('\r\n');
}

export function downloadIcs(game, url) {
  const text = buildIcs(game, url);
  if (!text) return false;
  const blob = new Blob([text], { type: 'text/calendar;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `krossi-peli-${(game.scheduledAt || '').slice(0, 10)}.ics`;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  return true;
}
