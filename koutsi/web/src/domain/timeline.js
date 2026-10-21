// timeline.js — builds the Kehitys timeline: one newest-first stream of everything that
// happened to a player (goals, own entries, coach notes, homework, moods, matches, videos, wishes, notes,
// trainings with their week's theme, club events). Ported from the old lib/koutsi-timeline.jsx
// builder unchanged; only the presentation is new (shared/Timeline.jsx).
import { activityById, ownEntry } from './ownWeek.js';
import {
  koutsiDateFromStr, koutsiTodayStr, koutsiFmtShortDate, koutsiTournamentLabel,
  KOUTSI_MONTHS, KOUTSI_ABSENCE_REASON_LABELS,
} from './core.js';

const KOUTSI_TL_MOOD_LABELS = { 1: 'Raskas', 2: 'Vaisu', 3: 'Ihan ok', 4: 'Hyvä', 5: 'Loistava' };
const KOUTSI_TL_PREVIOUS_LABELS = { goal: 'Aiempi tavoite', wish: 'Aiempi toive', note: 'Aiempi muistiinpano' };

// One entry per event kind: the filter chip label, the rail dot colour, and the little
// glyph in the card's badge. Order here is the order the filter chips appear in.
const KOUTSI_TL_KINDS = {
  goal: { label: 'Tavoitteet', short: 'Tavoite', fg: '#5c6b06', bg: 'rgba(180,205,20,0.28)', dot: '#b4cd14', icon: '◎' },
  entry: { label: 'Merkinnät', short: 'Merkintä', fg: '#121212', bg: 'rgba(180,205,20,0.18)', dot: '#121212', icon: '✓' },
  diary: { label: 'Valmentajalta', short: 'Valmentaja', fg: '#121212', bg: 'rgba(0,0,0,0.07)', dot: '#121212', icon: '✎' },
  homework: { label: 'Kotiläksyt', short: 'Kotiläksy', fg: '#8a5a12', bg: 'rgba(214,140,44,0.16)', dot: '#d68c2c', icon: '☑' },
  mood: { label: 'Fiilikset', short: 'Fiilis', fg: '#2a5d94', bg: 'rgba(58,130,212,0.13)', dot: '#3a82d4', icon: '☺' },
  match: { label: 'Ottelut', short: 'Ottelu', fg: '#a13b2f', bg: 'rgba(161,59,47,0.11)', dot: '#a13b2f', icon: '⚑' },
  video: { label: 'Videot', short: 'Video', fg: '#6a389c', bg: 'rgba(148,88,214,0.13)', dot: '#9458d6', icon: '▶' },
  wish: { label: 'Toiveet', short: 'Toive', fg: '#1f6b5c', bg: 'rgba(31,107,92,0.12)', dot: '#1f6b5c', icon: '✱' },
  note: { label: 'Muistiinpanot', short: 'Muistiinpano', fg: '#6a6a6a', bg: '#f1f1f1', dot: '#6a6a6a', icon: '✐' },
  event: { label: 'Tapahtumat', short: 'Tapahtuma', fg: '#94571a', bg: 'rgba(214,140,44,0.13)', dot: '#c07820', icon: '★' },
  training: { label: 'Treenit', short: 'Treeni', fg: '#4a4a4a', bg: '#f1f1f1', dot: '#a8a8a8', icon: '●' },
  start: { label: 'Alku', short: 'Alku', fg: '#4a4a4a', bg: '#f1f1f1', dot: '#a8a8a8', icon: '⚑' },
};
const KOUTSI_TL_KIND_ORDER = ['goal', 'entry', 'diary', 'homework', 'mood', 'match', 'video', 'wish', 'note', 'event', 'training', 'start'];

// ── time helpers ─────────────────────────────────────────────
// Sources mix full ISO timestamps (created_at) with plain date strings (a video's or a
// match note's own date). Both normalise to a sortable epoch and a local YYYY-MM-DD day.
function koutsiTlPad(n) { return String(n).padStart(2, '0'); }
function koutsiTlTime(at) {
  if (!at) return 0;
  if (at.length <= 10) { const d = koutsiDateFromStr(at); d.setHours(12, 0, 0, 0); return d.getTime(); }
  const t = new Date(at).getTime();
  return Number.isNaN(t) ? 0 : t;
}
function koutsiTlDay(at) {
  if (!at) return '';
  if (at.length <= 10) return at;
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${koutsiTlPad(d.getMonth() + 1)}-${koutsiTlPad(d.getDate())}`;
}
function koutsiTlMonthLabel(dayStr) {
  const [y, m] = dayStr.split('-').map(Number);
  const name = KOUTSI_MONTHS[m - 1] || '';
  return `${name.charAt(0).toUpperCase()}${name.slice(1)} ${y}`;
}
// "Tänään" / "Eilen" beat a date for the two days a player actually looks at.
function koutsiTlDayLabel(dayStr) {
  const today = koutsiTodayStr();
  if (dayStr === today) return 'Tänään';
  const y = koutsiDateFromStr(today);
  y.setDate(y.getDate() - 1);
  if (dayStr === `${y.getFullYear()}-${koutsiTlPad(y.getMonth() + 1)}-${koutsiTlPad(y.getDate())}`) return 'Eilen';
  const d = koutsiDateFromStr(dayStr);
  return `${d.getDate()}.${d.getMonth() + 1}.`;
}

// ── the builder ──────────────────────────────────────────────
// Turns one student (plus the trainings that concern them) into a flat, newest-first list
// of timeline events. `search` on each event is the blob the free-text filter matches, so
// searching "Venla" finds the match note and searching "syöttö" finds the coach's note.
function koutsiBuildTimeline(student, trainings, clubEvents, { viewer = 'player' } = {}) {
  const items = [];
  const push = (e) => { if (e.at) items.push(e); };

  (student.goalHistory || []).forEach((g) => push({
    id: `goal-${g.id}`, kind: 'goal', at: g.at, source: g,
    title: g.previousValue ? 'Tavoite päivitetty' : 'Tavoite asetettu',
    body: g.value || '(tavoite tyhjennetty)',
    previous: g.previousValue || '',
    search: `${g.value || ''} ${g.previousValue || ''} tavoite`,
  }));

  // The player's own "what I did, when and how it went". It sits on the day it happened.
  (student.entries || []).forEach((e) => push({
    id: `entry-${e.id}`, kind: 'entry', at: e.date || e.at, source: e,
    title: viewer === 'coach' ? 'Pelaajan merkintä' : 'Oma merkintä',
    body: e.text, how: e.how || '',
    search: `${e.text} ${e.how || ''} merkintä`,
  }));

  (student.diary || []).forEach((d) => push({
    id: `diary-${d.id != null ? d.id : d.at}`, kind: 'diary', at: d.at, source: d,
    title: 'Valmentajan huomio', body: d.text,
    search: `${d.text} valmentaja`,
  }));

  // Assigned and ticked-off are two separate moments, and putting "tehty" on the day the
  // coach assigned it would misdate the one thing the player actually did.
  (student.homework || []).forEach((h, i) => {
    const key = h.id != null ? h.id : i;
    push({
      id: `hw-${key}`, kind: 'homework', at: h.at, source: h,
      title: 'Kotiläksy', body: h.text,
      search: `${h.text} kotiläksy`,
    });
    if (h.done && h.doneAt) push({
      id: `hw-done-${key}`, kind: 'homework', at: h.doneAt, source: h,
      title: 'Kotiläksy tehty', body: h.text, done: true,
      search: `${h.text} kotiläksy tehty`,
    });
  });

  (student.moods || []).forEach((m, i) => push({
    id: `mood-${m.id != null ? m.id : i}`, kind: 'mood', at: m.at, source: m,
    title: `Fiilis treenin jälkeen: ${KOUTSI_TL_MOOD_LABELS[m.score] || m.score}`,
    body: m.note || '', score: m.score, hidden: !!m.hiddenFromCoach,
    search: `${m.note || ''} fiilis ${KOUTSI_TL_MOOD_LABELS[m.score] || ''}`,
  }));

  (student.matchNotes || []).forEach((n) => {
    const resultLabel = n.result === 'voitto' ? 'Voitto' : n.result === 'tappio' ? 'Tappio' : '';
    const opponents = n.format === 'nelinpeli' && n.opponent2Name ? `${n.opponentName} & ${n.opponent2Name}` : n.opponentName;
    const tournament = n.tournamentId ? (trainings || []).find((t) => t.id === n.tournamentId) : null;
    const tournamentLabel = tournament ? koutsiTournamentLabel(tournament) : '';
    const meta = [
      resultLabel, n.score,
      n.format === 'nelinpeli' ? 'Nelinpeli' : n.format === 'kaksinpeli' ? 'Kaksinpeli' : '',
      n.format === 'nelinpeli' && n.partnerName ? `Pari: ${n.partnerName}` : '',
      tournamentLabel ? `Turnaus: ${tournamentLabel}` : '',
    ].filter(Boolean).join(' · ');
    push({
      id: `match-${n.id}`, kind: 'match', at: n.at || n.date, source: n,
      title: `Ottelu: ${opponents}${resultLabel ? ` — ${resultLabel}` : ''}`,
      body: [meta, n.note || ''].filter(Boolean).join('\n'),
      search: `${opponents} ${n.partnerName || ''} ${n.note || ''} ${n.score || ''} ${tournamentLabel} ottelu vastustaja ${resultLabel}`,
    });
  });

  (student.videos || []).forEach((v, i) => push({
    id: `video-${v.id != null ? v.id : i}`, kind: 'video', at: v.at || v.date, source: v,
    title: v.addedBy === 'player' ? 'Lisäsit videon' : 'Valmentaja lisäsi videon',
    body: v.title, video: v, tags: v.tags || [],
    search: `${v.title} video ${(v.tags || []).join(' ')}`,
  }));

  // The wish and the player's own note overwrite themselves exactly like the goal did, so
  // each edit is kept and shown the same way — with what it replaced underneath.
  (student.wishHistory || []).forEach((w) => push({
    id: `wish-${w.id}`, kind: 'wish', at: w.at, source: w,
    title: w.previousValue ? 'Toive päivitetty' : 'Toive valmentajalle',
    body: w.value || '(toive tyhjennetty)', previous: w.previousValue || '',
    search: `${w.value || ''} ${w.previousValue || ''} toive`,
  }));

  (student.noteHistory || []).forEach((n) => push({
    id: `note-${n.id}`, kind: 'note', at: n.at, source: n,
    title: n.previousValue ? 'Muistiinpano päivitetty' : 'Oma muistiinpano',
    body: n.value || '(muistiinpano tyhjennetty)', previous: n.previousValue || '',
    search: `${n.value || ''} ${n.previousValue || ''} muistiinpano`,
  }));

  // Only sessions that have already happened belong on a history timeline; the upcoming
  // ones live on the Treenit tab.
  const today = koutsiTodayStr();
  (trainings || []).filter((t) => t.date <= today).forEach((t) => {
    const absence = (t.absences || []).find((a) => a.studentId === student.id);
    const reason = absence ? (KOUTSI_ABSENCE_REASON_LABELS[absence.reason] || 'Poissa') : '';
    // A tournament entry's matches are logged as separate match notes linked back to it
    // (MatchNoteModal's "Turnaus" picker) — surface the tally here so the tournament card
    // itself answers "how did it go" without opening every linked match.
    const tournamentMatches = t.type === 'Turnaus' ? (student.matchNotes || []).filter((n) => n.tournamentId === t.id) : [];
    const tournamentSummary = tournamentMatches.length
      ? `${tournamentMatches.length} ${tournamentMatches.length === 1 ? 'ottelu' : 'ottelua'} · ${tournamentMatches.filter((n) => n.result === 'voitto').length} voittoa, ${tournamentMatches.filter((n) => n.result === 'tappio').length} tappiota`
      : '';
    // A player's own session says what was done: "Lenkki" rather than its category "Fysiikka"
    // when the renewed app's log named it (domain/ownWeek.js), the length and their own words.
    const own = t.loggedBy === 'player' ? ownEntry(t) : null;
    const named = Boolean(own && activityById(own.activity).word);
    push({
      id: `training-${t.id}`, kind: 'training', at: t.date,
      title: absence ? `${t.type} — ${reason}` : named ? own.title : t.type,
      body: [t.groupName || '', t.themeTitle ? `Teema: ${t.themeTitle}` : '', own && t.durationMinutes ? `${t.durationMinutes} min` : '',
        own ? (named ? own.text : (t.notes || '').trim()) : '', absence?.note || '', tournamentSummary].filter(Boolean).join(' · '),
      time: t.time, absent: !!absence,
      search: `${t.type} ${t.groupName || ''} treeni ${reason} ${absence?.note || ''} ${t.themeTitle || ''} ${t.loggedBy === 'player' ? t.notes || '' : ''}`,
    });
  });

  // Club tournaments and play days are things that happened to the player too, even though
  // they belong to the club rather than to one student.
  (clubEvents || []).filter((e) => (e.endDate || e.date) <= today).forEach((e) => push({
    id: `event-${e.id}`, kind: 'event', at: e.endDate || e.date,
    title: e.title, body: [e.kind ? `Seuran ${e.kind}` : '', e.endDate && e.endDate !== e.date ? `${koutsiFmtShortDate(e.date)}–${koutsiFmtShortDate(e.endDate)}` : ''].filter(Boolean).join(' · '),
    search: `${e.title} ${e.kind || ''} tapahtuma seura`,
  }));

  if (student.joinedAt) push({
    id: 'start', kind: 'start', at: student.joinedAt,
    // The coach reads the same history about someone else.
    title: viewer === 'coach' ? 'Aloitti Krossi Koutsissa' : 'Aloitit Krossi Koutsissa',
    body: viewer === 'coach' ? 'Tästä pelaajan kehityshistoria lähtee liikkeelle.' : 'Tästä kehityshistoriasi lähtee liikkeelle.',
    search: 'alku aloitus',
  });

  return items.sort((a, b) => koutsiTlTime(b.at) - koutsiTlTime(a.at));
}

// "Tänään" / "Eilen" / "ma 18.8." — the same reading wherever a single event is shown
// outside the timeline (the coach's diary list, the player's latest note).
function koutsiFmtEventDate(at) {
  const day = koutsiTlDay(at);
  if (!day) return '';
  const label = koutsiTlDayLabel(day);
  return (label === 'Tänään' || label === 'Eilen') ? label : koutsiFmtShortDate(day);
}

export {
  KOUTSI_TL_MOOD_LABELS, KOUTSI_TL_PREVIOUS_LABELS, KOUTSI_TL_KINDS, KOUTSI_TL_KIND_ORDER,
  koutsiTlTime, koutsiTlDay, koutsiTlMonthLabel, koutsiTlDayLabel, koutsiBuildTimeline, koutsiFmtEventDate,
};
