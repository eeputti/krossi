// continueGroups.js: "Jatka kalenteria". The chosen groups go on with the same weekdays and
// times up to a day, and a break (tauko) is a range of days with no sessions. Pure: the sheet shows
// this plan before saving, and the save does the same two things. It cancels the sessions already in
// a break, then continues each group with groups.extendSeries(id, until, breakDays). The server
// (koutsi_extend_group_series) stays the source of truth; this mirrors it so the summary is right.
import { koutsiAddDays, koutsiDateFromStr, koutsiFmtShortDate, koutsiTodayStr } from './core.js';

const JS_DAY = { Su: 0, Ma: 1, Ti: 2, Ke: 3, To: 4, Pe: 5, La: 6 };
const MAX_WEEKS = 60; // per weekly time, like the server
export const MAX_DAYS_AHEAD = 400; // the server refuses a later day
export const BREAK_NAME = 'Treenitauko'; // a break without a name
export const BREAK_NAME_MAX = 60;
export const BREAK_MESSAGE_MAX = 200; // koutsi_coach_events_message_length: the letter fits one notification

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
          add.push({ date: d, time: slot.time });
        }
      }
    }
    add.sort(bySession);
    const last = [...mine.map((t) => t.date), ...add.map((a) => a.date)].sort().pop() || null;
    return { group, add, cancel: cancel.filter((t) => t.groupId === group.id), last };
  });

  // every session of the chosen groups after saving: { date, time, group }
  const sessions = [
    ...kept.map((t) => ({ date: t.date, time: t.time, group: perGroup.find((p) => p.group.id === t.groupId).group })),
    ...perGroup.flatMap((p) => p.add.map((a) => ({ ...a, group: p.group }))),
  ].sort(bySession);
  return {
    groups: perGroup,
    added: perGroup.reduce((n, p) => n + p.add.length, 0),
    cancel,
    breaks: ok.map((b) => {
      const first = sessions.find((x) => x.date > b.to) || null;
      return {
        ...b,
        cancelled: cancel.filter((t) => t.date >= b.from && t.date <= b.to).length,
        next: first?.date || null,
        // the first session after the break: the example in the notice preview
        example: first,
      };
    }),
  };
}

function bySession(a, b) { return a.date.localeCompare(b.date) || String(a.time).localeCompare(String(b.time)); }

/**
 * The holiday letter a player gets the morning before a break, word for word as koutsi_break_notice_title /
 * koutsi_break_notice_body (supabase/migrations …_koutsi_break_mails.sql) write it. `next` is that player's
 * first session after the break, `coach` the coach's first name, `sendDay` the day it goes. In the mail the
 * first line of each paragraph is bold.
 */
export function breakNotice({ name, from, to, next, message, coach, sendDay }) {
  const title = (name || '').trim() || BREAK_NAME;
  const days = to && to > from ? `${koutsiFmtShortDate(from)}–${koutsiFmtShortDate(to)}` : koutsiFmtShortDate(from);
  const first = [`Treenit ovat tauolla ${days}`];
  if (next?.date) first.push(`Treenisi jatkuvat ${koutsiFmtShortDate(next.date)} klo ${next.time}.`);
  const blocks = [first.join('\n')];
  if ((message || '').trim()) blocks.push(['Valmentajan terveiset', message.trim(), ...((coach || '').trim() ? [`– ${coach.trim()}`] : [])].join('\n'));
  blocks.push('Koutsi on käytössä myös tauon aikana.\nTreenaa omatoimisesti ja merkitse treenit kuten ennenkin. Vain yhteiset treenit ovat tauolla.');
  return { title: sendDay && sendDay < from ? `${title} alkaa huomenna` : title, body: blocks.join('\n\n') };
}

/**
 * The reminders before the sessions start again (koutsi_send_break_notices, part 2): after a break of a
 * week or more, three days and one day before the player's own first session. [{ day, title, body }]
 */
export function restartNotices({ from, to, next, theme }) {
  if (!next?.date || !to || koutsiAddDays(from, 6) > to) return [];
  const topic = (theme || '').trim().replace(/\.+$/, '');
  const body = (tomorrow) => [
    [`Ensimmäinen treenisi tauon jälkeen on ${tomorrow ? 'huomenna ' : ''}${koutsiFmtShortDate(next.date)} klo ${next.time}.`, ...(topic ? [`Viikon teema: ${topic}.`] : [])].join('\n'),
    'Avaa Koutsi ja katso, miten treenit alkavat.',
  ].join('\n\n');
  return [
    { day: koutsiAddDays(next.date, -3), title: `Treenit alkavat taas ${koutsiFmtShortDate(next.date)}`, body: body(false) },
    { day: koutsiAddDays(next.date, -1), title: 'Treenit alkavat taas huomenna', body: body(true) },
  ].filter((r) => r.day >= from);
}

/** The day the players are told: the morning before the break starts, or at once when that has passed. */
export function noticeDay(from, today = koutsiTodayStr()) {
  const before = koutsiAddDays(from, -1);
  return before > today ? before : today;
}

/**
 * When the letter goes, in the coach's words. The job runs at :35 from 07:35 to 20:35 (Helsinki), so a
 * morning's letters are out before 8. → { day, label }
 */
export function noticeWhen(from, now = new Date()) {
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const day = noticeDay(from, today);
  if (day > today) return { day, label: `${fmtDay(day, today)} aamulla klo 8 mennessä` };
  const minutes = now.getHours() * 60 + now.getMinutes();
  if (minutes < 7 * 60 + 30) return { day, label: 'tänään aamulla klo 8 mennessä' };
  if (minutes < 20 * 60 + 35) return { day, label: 'tunnin sisällä tallennuksesta' };
  return { day: koutsiAddDays(today, 1), label: 'huomenna aamulla klo 8 mennessä' };
}
