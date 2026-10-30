// MerkitseSheet — the player's big middle button of the phone tab bar (the side nav's button on a
// desktop). It leads with what is happening: the sessions that just ended, one slide each to rate
// with one tap (or all at once), otherwise the next session with its "En pääse". Below, "Mitä
// teit?" as one-tap tiles (each opens a short form with the day and time filled in), and the
// player's other entries as rows: how they feel right now, their goals, and a request to the coach.
//
// AfterSessions is also Koti's first card, so the same slides show wherever the player looks.
import { useEffect, useRef, useState } from 'react';
import { api } from '../api/index.js';
import { useData } from '../app/data.jsx';
import { navigate } from '../app/router.js';
import { useMessages } from '../shared/messages/MessagesProvider.jsx';
import { useNow } from '../app/hooks.js';
import { Button, Icon, Sheet, useToast } from '../ui/index.js';
import { koutsiGroupById, koutsiThemeForDate, koutsiTimeRangeLabel } from '../domain/core.js';
import { relativeDay, shortDay } from '../domain/week.js';
import { firstOpenSlide, merkitseLead, moodFor, spanLabel, ambitionById } from '../domain/playerNow.js';
import { ACTIVITIES } from '../domain/ownWeek.js';
import { planSummary, readPlan } from '../domain/plan.js';
import { MOOD_LABELS } from '../lib/constants.js';
import { MoodPicker } from './sheets.jsx';
import { ActivityIcon } from './ActivityIcon.jsx';
import { markSkipped, readSkipped } from './checkin.js';
import { usePlayerActions } from './PlayerApp.jsx';

const cx = (...c) => c.filter(Boolean).join(' ');

// "Ohita" on Koti or in Merkitse hides the same sessions in both at once.
const skipListeners = new Set();
const notifyLead = () => skipListeners.forEach((fn) => fn());

// After the last open session gets its number, the slides stay a moment ("Kiitos! Hyvä") so the
// tap is seen; then Merkitse closes (CLOSE_AFTER_MS) and the card goes (HOLD_MS, a little later,
// so nothing jumps while the sheet slides down). Before this the card vanished the instant the
// data came back and "Fiilis nyt" took its place, as if the tap had not counted.
const CLOSE_AFTER_MS = 700;
const HOLD_MS = 1100;
let held = null; // { studentId, ended, until }
function holdLead(studentId, ended) {
  held = { studentId, ended, until: Date.now() + HOLD_MS };
  setTimeout(() => { if (held && Date.now() >= held.until) { held = null; notifyLead(); } }, HOLD_MS + 20);
}

/** The lead for this player now; skipped sessions are kept in localStorage (checkin.js). */
export function useLead() {
  const { state } = useData();
  const student = state.students[0];
  const nowMs = useNow(60_000);
  const [, bump] = useState(0);
  useEffect(() => {
    const listener = () => bump((n) => n + 1);
    skipListeners.add(listener);
    return () => { skipListeners.delete(listener); };
  }, []);
  const skipped = readSkipped(student.id);
  let lead = merkitseLead(state, student, { now: new Date(nowMs), skipped, perSession: Boolean(state.moodSessionsReady) });
  if (!lead.ended.length && held && held.studentId === student.id && Date.now() < held.until) {
    lead = { ...lead, ended: held.ended.map((x) => ({ ...x, mood: moodFor(student, x.training) || x.mood })) };
  }
  const skip = (ids) => {
    ids.forEach((id) => markSkipped(student.id, id));
    notifyLead();
  };
  return { lead, skip };
}

function sessionLine(state, training) {
  const group = training.groupId ? koutsiGroupById(state, training.groupId) : null;
  const theme = group ? koutsiThemeForDate(group, training.date) : null;
  return { group, theme, name: group?.name || training.type };
}

/**
 * The sessions that just ended, one slide each: one tap on a number saves how it went for that
 * session; "Kirjoita mitä opit" opens the words. With several, the player swipes from one to the
 * next (the next open one comes into view by itself) or answers all at once. The tapped number
 * turns dark at once, before the save is back; `onDone` runs a moment after the last one is
 * answered (Merkitse closes itself).
 */
export function AfterSessions({ ended, onSkip, onDone, className }) {
  const { state, run, reload } = useData();
  const actions = usePlayerActions();
  const toast = useToast();
  const student = state.students[0];
  const perSession = Boolean(state.moodSessionsReady);
  const track = useRef(null);
  const [index, setIndex] = useState(() => firstOpenSlide(ended));
  const [busy, setBusy] = useState(null);
  // trainingId → { id, score }: the number just tapped, shown until the data has caught up
  const [picked, setPicked] = useState({});
  const moodOf = (item) => {
    const p = picked[item.training.id];
    if (!p) return item.mood;
    return { ...(item.mood || {}), id: p.id || item.mood?.id || null, score: p.score };
  };
  const unpick = (id) => setPicked((p) => { const next = { ...p }; delete next[id]; return next; });
  // once the reloaded data says the same, the data is the truth again
  useEffect(() => {
    setPicked((p) => {
      const caughtUp = ended.filter((x) => p[x.training.id] && x.mood && x.mood.id === p[x.training.id].id && x.mood.score === p[x.training.id].score);
      if (!caughtUp.length) return p;
      const next = { ...p };
      caughtUp.forEach((x) => { delete next[x.training.id]; });
      return next;
    });
  }, [ended]);
  const many = ended.length > 1;
  const allDone = ended.every((x) => moodOf(x));

  const scrollTo = (i, smooth = true) => {
    const box = track.current;
    const slide = box?.children[i];
    if (box && slide) box.scrollTo({ left: slide.offsetLeft - box.offsetLeft, behavior: smooth ? 'smooth' : 'auto' });
  };
  useEffect(() => { scrollTo(firstOpenSlide(ended), false); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const onScroll = () => {
    const box = track.current;
    if (!box || !box.children.length) return;
    const w = box.children[0].offsetWidth || 1;
    setIndex(Math.max(0, Math.min(ended.length - 1, Math.round(box.scrollLeft / w))));
  };

  const rate = async (item, i, score) => {
    const id = item.training.id;
    if (busy === id) return;
    const current = moodOf(item);
    if (current?.id) {
      if (score === current.score) return;
      setPicked((p) => ({ ...p, [id]: { id: current.id, score } }));
      const res = await run(() => api.player.updateMood(current.id, { score }), undefined, { refresh: false });
      if (res.ok) reload().catch(() => {});
      else unpick(id);
      return;
    }
    setBusy(id);
    setPicked((p) => ({ ...p, [id]: { id: null, score } }));
    const res = await run(() => api.player.addMood(student.id, { score, note: '', hiddenFromCoach: false, trainingId: perSession ? id : null }), undefined, { refresh: false });
    setBusy(null);
    if (!res.ok) { unpick(id); return; }
    const mood = { id: res.result?.id || null, score };
    setPicked((p) => ({ ...p, [id]: mood }));
    const answered = ended.map((x) => (x.training.id === id ? { ...x, mood: { ...mood, note: '' } } : { ...x, mood: moodOf(x) }));
    // the next open slide after this one, else one before it; none = all answered
    const after = answered.findIndex((x, j) => j > i && !x.mood);
    const nextOpen = after >= 0 ? after : answered.findIndex((x) => !x.mood);
    if (nextOpen < 0) holdLead(student.id, answered);
    reload().catch(() => {});
    toast(`Fiilis tallennettu: ${MOOD_LABELS[score]}.`, { action: { label: 'Lisää sanoja', onClick: () => actions.openCheckIn(item.training, { mood }) }, duration: 5000 });
    if (nextOpen >= 0) setTimeout(() => scrollTo(nextOpen), 350);
    else if (onDone) setTimeout(onDone, CLOSE_AFTER_MS);
  };

  const first = ended[0].training;
  const dayWord = relativeDay(first.date);
  const head = many
    ? `${dayWord === 'Tänään' ? 'Tänään' : dayWord === 'Eilen' ? 'Eilen' : shortDay(first.date)} ${ended.length} treeniä klo ${spanLabel(ended)}`
    : null;

  return (
    <section className={cx('pn-after', className)} aria-label="Treenit ohi">
      {many && (
        <div className="pn-after-head">
          <span className="eyebrow">{head}</span>
          <span className="pn-count t-num">{index + 1}/{ended.length}</span>
        </div>
      )}
      <div className={cx('pn-slides', many && 'is-many')} ref={track} onScroll={many ? onScroll : undefined}>
        {ended.map((item, i) => {
          const mood = moodOf(item);
          const { theme, name } = sessionLine(state, item.training);
          const day = relativeDay(item.training.date);
          const when = day === 'Tänään' ? `Päättyi klo ${item.end}` : `${day === 'Eilen' ? 'Eilen' : shortDay(item.training.date)} klo ${item.training.time}`;
          return (
            <article key={item.training.id} className={cx('pn-slide', mood && 'is-done')} aria-label={`${name} ${item.training.time}`}>
              <div className="eyebrow pn-when">{many ? `Klo ${item.training.time}–${item.end}` : `Treeni ohi, ${when}`}</div>
              <h3 className="pn-title" aria-live="polite">{mood ? `Kiitos! ${MOOD_LABELS[mood.score]}` : 'Miten meni?'}</h3>
              <p className="pn-sub">{name}{theme ? `, ${theme.title}` : ''}</p>
              <MoodPicker value={mood?.score ?? null} onChange={(score) => rate(item, i, score)} size="sm" />
              <button type="button" className="pn-link" onClick={() => actions.openCheckIn(item.training, { mood: mood?.id ? mood : null })}>
                <Icon name="edit" size={15} /><span>{mood?.note ? 'Muokkaa mitä kirjoitit' : 'Kirjoita mitä opit treenissä'}</span>
              </button>
            </article>
          );
        })}
      </div>
      <div className="pn-after-foot">
        {many && <div className="pn-dots" aria-hidden="true">{ended.map((x, i) => <span key={x.training.id} className={cx('pn-dot', i === index && 'is-on', moodOf(x) && 'is-done')} />)}</div>}
        <span className="grow" />
        {many && !allDone && perSession && <Button variant="ghost" size="sm" onClick={() => actions.openCheckIn(null, { all: ended.filter((x) => !moodOf(x)).map((x) => x.training) })}>Kaikista kerralla</Button>}
        {!allDone && onSkip && (
          <button type="button" className="pn-skip" onClick={() => onSkip(ended.filter((x) => !moodOf(x)).map((x) => x.training.id))}>Ohita</button>
        )}
      </div>
    </section>
  );
}

/** The next coach-run session: when, what, "En pääse" / "Pääsenkin", its plan, and the one after. */
function NextUp({ next, then }) {
  const { state, ownerId } = useData();
  const actions = usePlayerActions();
  const { group, theme, name } = sessionLine(state, next);
  const absent = (next.absences || []).some((a) => a.studentId === ownerId);
  const plan = readPlan(next.notes);
  const day = relativeDay(next.date);
  return (
    <section className={cx('pn-next', absent && 'is-absent')} aria-label="Seuraava treeni">
      <div className="eyebrow pn-next-eyebrow">{day === 'Tänään' ? 'Tänään' : 'Seuraava treeni'}</div>
      <div className="pn-next-when"><span>{day}</span> <span className="t-num">klo {koutsiTimeRangeLabel(next.time, next.durationMinutes || group?.durationMinutes)}</span></div>
      <p className="pn-next-what">{name}{theme ? `, ${theme.title}` : ''}</p>
      <div className="row wrap">
        {absent
          ? <><span className="chip chip-md chip-warn">Ilmoitit poissaolon</span><Button variant="lime" size="sm" onClick={() => actions.openAbsence(next)}>Pääsenkin</Button></>
          : <Button variant="lime" size="sm" icon="close" onClick={() => actions.openAbsence(next)}>En pääse</Button>}
        {plan.items.length > 0 && <Button variant="outline" size="sm" icon="list" className="pn-next-plan" onClick={() => actions.openPlan(next)}>Treenin runko</Button>}
      </div>
      {plan.items.length > 0 && <p className="pn-next-then">{planSummary(plan)}</p>}
      {then && <p className="pn-next-then">Sitten {shortDay(then.date)} klo {then.time}, {sessionLine(state, then).name}</p>}
    </section>
  );
}

/**
 * One tap on a number saves how the player feels right now (no session). The number stays lit with
 * "Tallennettu" under the title, another tap changes it, and `onDone` (Merkitse closes) follows a
 * moment later.
 */
function FeelingRow({ onDone }) {
  const { state, run, reload } = useData();
  const toast = useToast();
  const student = state.students[0];
  const [picked, setPicked] = useState(null); // { id, score }; id is null while the save is on its way
  const pick = async (score) => {
    if (picked) {
      if (!picked.id || score === picked.score) return;
      const before = picked;
      setPicked({ ...picked, score });
      const res = await run(() => api.player.updateMood(before.id, { score }), undefined, { refresh: false });
      if (!res.ok) setPicked(before);
      return;
    }
    setPicked({ id: null, score });
    const res = await run(() => api.player.addMood(student.id, { score, note: '', hiddenFromCoach: false, trainingId: null }), undefined, { refresh: false });
    if (!res.ok) { setPicked(null); return; }
    const id = res.result?.id || null;
    setPicked({ id, score });
    toast(`Fiilis tallennettu: ${MOOD_LABELS[score]}.`, id ? { action: { label: 'Vain minulle', onClick: () => run(() => api.player.setMoodHidden(id, true), 'Fiilis näkyy vain sinulle.') }, duration: 6000 } : {});
    setTimeout(() => { onDone?.(); reload().catch(() => {}); }, CLOSE_AFTER_MS);
  };
  return (
    <div className={cx('ms-row pn-feel', picked && 'is-done')}>
      <span className="ms-row-icon"><Icon name={picked ? 'check' : 'heart'} size={16} /></span>
      <span className="ms-row-main">
        <span className="ms-row-title">Fiilis nyt</span>
        <span className="ms-row-sub" aria-live="polite">{picked ? `Tallennettu: ${MOOD_LABELS[picked.score]}` : 'Miltä tuntuu?'}</span>
      </span>
      <span className="pn-feel-nums" role="radiogroup" aria-label="Fiilis nyt">
        {[1, 2, 3, 4, 5].map((n) => (
          <button key={n} type="button" role="radio" aria-checked={picked?.score === n} aria-label={`${n} ${MOOD_LABELS[n]}`}
            className={cx('pn-feel-num t-num', picked?.score === n && 'is-on')} data-score={n} onClick={() => pick(n)}>{n}</button>
        ))}
      </span>
    </div>
  );
}

export function MerkitseSheet({ open, onClose }) {
  const { state } = useData();
  const actions = usePlayerActions();
  const student = state.students[0];
  const msgs = useMessages();
  const canMessage = msgs.ready && msgs.threads.some((t) => t.enabled);
  const { lead, skip } = useLead();
  const openHomework = (student.homework || []).filter((h) => !h.done);
  // Games first (what players asked for), then training of their own, then anything else.
  const order = ['tennis', 'ottelu', 'turnaus', 'sali', 'lenkki', 'liikkuvuus', 'muu', 'kotilaksy'];
  const tiles = [
    ...ACTIVITIES.filter((a) => !a.hidden && (!a.homework || openHomework.length > 0)).sort((x, y) => order.indexOf(x.id) - order.indexOf(y.id)),
    ...(state.entriesReady ? [{ id: 'merkinta', label: 'Oma merkintä', entry: true }] : []),
  ];
  const pick = (a) => {
    if (a.match) actions.openMatch();
    else if (a.entry) actions.openEntry();
    else actions.openSelfTraining(undefined, { activity: a.id, homeworkId: a.homework ? openHomework[0]?.id : null, locked: true });
  };
  const ambition = ambitionById(student.ambition);
  const goalSub = [student.goal, ambition && (student.longGoal || ambition.label)].filter(Boolean).join(', ') || 'Mitä haluat oppia? Mihin tähtäät?';
  const hasAfter = lead.ended.length > 0;
  return (
    <Sheet open={open} onClose={onClose} title="Merkitse" size="md" className="pn-sheet">
      <div className="stack-4">
        {hasAfter
          ? <AfterSessions ended={lead.ended} onSkip={skip} onDone={actions.closeMerkitse} />
          : lead.next && <NextUp next={lead.next} then={lead.then} />}
        {hasAfter && lead.next && (
          <p className="pn-later"><Icon name="calendar" size={14} /> Seuraava: {relativeDay(lead.next.date) === 'Tänään' ? 'tänään' : shortDay(lead.next.date)} klo {lead.next.time}, {sessionLine(state, lead.next).name}</p>
        )}
        <section className="stack-2" aria-label="Mitä teit?">
          <h3 className="pn-h">Mitä teit?</h3>
          <div className="pn-tiles">
            {tiles.map((a) => (
              <button key={a.id} type="button" className="pn-tile" onClick={() => pick(a)}>
                <span className="pn-tile-icon">{a.entry ? <Icon name="edit" size={22} /> : <ActivityIcon activity={a.id} size={22} />}</span>
                <span className="pn-tile-label">{a.label}</span>
              </button>
            ))}
          </div>
        </section>
        <div className="ms-others-list">
          {!hasAfter && <FeelingRow onDone={actions.closeMerkitse} />}
          <button type="button" className="ms-row" onClick={() => actions.openGoals()}>
            <span className="ms-row-icon"><Icon name="target" size={16} /></span>
            <span className="ms-row-main"><span className="ms-row-title">Tavoitteet</span><span className="ms-row-sub">{goalSub}</span></span>
            <Icon name="chevron-right" size={16} className="k-chevron" />
          </button>
          <button type="button" className="ms-row" onClick={() => actions.openText('wish')}>
            <span className="ms-row-icon"><Icon name="chat" size={16} /></span>
            <span className="ms-row-main"><span className="ms-row-title">Toive valmentajalle</span><span className="ms-row-sub">{student.playerWish || 'Mitä haluaisit harjoitella seuraavaksi?'}</span></span>
            <Icon name="chevron-right" size={16} className="k-chevron" />
          </button>
          {canMessage && (
            <button type="button" className="ms-row" onClick={() => { onClose(); navigate('/pelaaja/viestit'); }}>
              <span className="ms-row-icon"><Icon name="send" size={16} /></span>
              <span className="ms-row-main"><span className="ms-row-title">Viesti valmentajalle</span><span className="ms-row-sub">Kysy tai kerro jotain kahden kesken</span></span>
              <Icon name="chevron-right" size={16} className="k-chevron" />
            </button>
          )}
        </div>
      </div>
    </Sheet>
  );
}
