// continueGroups.js: "Jatka kalenteria". The chosen groups go on with the same weekdays and
// times up to a day, and a break (tauko) is a range of days with no sessions. Pure: the sheet shows
// this plan before saving, and the save does the same two things. It cancels the sessions already in
// a break, then continues each group with groups.extendSeries(id, until, breakDays). The server
// (koutsi_extend_group_series) stays the source of truth; this mirrors it so the summary is right.
import { koutsiAddDays, koutsiDateFromStr, koutsiFmtShortDate, koutsiTodayStr } from './core.js';

const JS_DAY = { Su: 0, Ma: 1, Ti: 2, Ke: 3, To: 4, Pe: 5, La: 6 };
const MAX_WEEKS = 60; // per weekly time, like the server
export const MAX_DAYS_AHEAD = 400; // the server refuses a later day

/** A day for the summary: "to 7.1.", with the year when it isn't this year's ("to 7.1.2027"). */
export function fmtDay(date, today = koutsiTodayStr()) {
  const short = koutsiFmtShortDate(date);
  return date.slice(0, 4) === today.slice(0, 4) ? short : `${short}${date.slice(0, 4)}`;
}

/** The breaks that are filled in: both days set, the end on or after the start. */
export function validBreaks(breaks) {
  return (breaks || []).filter((b) => b && b.from && b.to && b.to >= b.from);
}

/** What is wrong with the break rows, in the coach's words, or null. */
export function breakProblem(breaks, today = koutsiTodayStr()) {
  for (const b of breaks || []) {
    if (!b?.from || !b?.to) return 'Valitse tauon alku- ja loppupäivä.';
    if (b.to < b.from) return 'Tauon loppupäivä on ennen alkua.';
    if (b.to < today) return 'Tauko on jo mennyt. Valitse tulevat päivät.';
  }
  return null;
}

const inBreak = (date, breaks) => breaks.some((b) => date >= b.from && date <= b.to);

/** Every break day from `from` to `until`: the days extendSeries leaves out. */
export function breakDays(breaks, from, until) {
  const out = new Set();
  for (const b of validBreaks(breaks)) {
    let d = b.from > from ? b.from : from;
    const end = b.to < until ? b.to : until;
    for (let i = 0; d <= end && i < 400; i += 1, d = koutsiAddDays(d, 1)) out.add(d);
  }
  return [...out].sort();
}

/** The term end after `date`: 31.5., 31.8. or 20.12. (the default when the calendar already reaches the usual one). */
export function nextTermEnd(date) {
  const y = Number(date.slice(0, 4));
  return [`${y}-05-31`, `${y}-08-31`, `${y}-12-20`, `${y + 1}-05-31`].find((d) => d > date);
}

const weeklyTimes = (group) => [
  { day: group.day, time: group.time },
  ...(group.slots || []).map((s) => ({ day: s.day, time: s.time })),
].filter((s) => JS_DAY[s.day] !== undefined && s.time);

/**
 * The plan for the chosen groups:
 *   groups:  [{ group, add: [dates], cancel: [sessions], last }]  last = the calendar's last day after saving
 *   added:   how many new sessions in all
 *   cancel:  the sessions already in a break (from today on), cancelled first
 *   breaks:  [{ from, to, cancelled, next }]  next = the first session after the break, or null
 */
export function planContinue({ groups, trainings, until, breaks, today = koutsiTodayStr() }) {
  const ok = validBreaks(breaks).sort((a, b) => a.from.localeCompare(b.from));
  const ids = new Set((groups || []).map((g) => g.id));
  const own = (trainings || []).filter((t) => ids.has(t.groupId) && t.loggedBy !== 'player');
  const cancel = own.filter((t) => t.date >= today && inBreak(t.date, ok));
  const cancelled = new Set(cancel.map((t) => t.id));
  const kept = own.filter((t) => !cancelled.has(t.id));

  const perGroup = (groups || []).map((group) => {
    const mine = kept.filter((t) => t.groupId === group.id);
    const add = [];
    if (until && until > today) {
      for (const slot of weeklyTimes(group)) {
        const dow = JS_DAY[slot.day];
        const last = mine.filter((t) => t.time === slot.time && koutsiDateFromStr(t.date).getDay() === dow).map((t) => t.date).sort().pop();
        let d = last && last >= today ? koutsiAddDays(last, 1) : today;
        d = koutsiAddDays(d, (dow - koutsiDateFromStr(d).getDay() + 7) % 7);
        for (let i = 0; d <= until && i < MAX_WEEKS; i += 1, d = koutsiAddDays(d, 7)) {
          if (inBreak(d, ok) || mine.some((t) => t.date === d && t.time === slot.time)) continue;
          add.push(d);
        }
      }
    }
    add.sort();
    const last = [...mine.map((t) => t.date), ...add].sort().pop() || null;
    return { group, add, cancel: cancel.filter((t) => t.groupId === group.id), last };
  });

  const days = [...kept.map((t) => t.date), ...perGroup.flatMap((p) => p.add)].sort();
  return {
    groups: perGroup,
    added: perGroup.reduce((n, p) => n + p.add.length, 0),
    cancel,
    breaks: ok.map((b) => ({
      ...b,
      cancelled: cancel.filter((t) => t.date >= b.from && t.date <= b.to).length,
      next: days.find((d) => d > b.to) || null,
    })),
  };
}
