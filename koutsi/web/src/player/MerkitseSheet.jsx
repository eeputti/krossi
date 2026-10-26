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
import { firstOpenSlide, merkitseLead, spanLabel, ambitionById } from '../domain/playerNow.js';
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
  const lead = merkitseLead(state, student, { now: new Date(nowMs), skipped, perSession: Boolean(state.moodSessionsReady) });
  const skip = (ids) => {
    ids.forEach((id) => markSkipped(student.id, id));
    skipListeners.forEach((fn) => fn());
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
 * next (the next open one comes into view by itself) or answers all at once.
 */
export function AfterSessions({ ended, onSkip, className }) {
  const { state, run } = useData();
  const actions = usePlayerActions();
  const toast = useToast();
  const student = state.students[0];
  const perSession = Boolean(state.moodSessionsReady);
  const track = useRef(null);
  const [index, setIndex] = useState(() => firstOpenSlide(ended));
  const [busy, setBusy] = useState(null);
  const many = ended.length > 1;
  const allDone = ended.every((x) => x.mood);

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
    if (busy) return;
    if (item.mood) {
      if (score !== item.mood.score) await run(() => api.player.updateMood(item.mood.id, { score }));
      return;
    }
    setBusy(item.training.id);
    const res = await run(() => api.player.addMood(student.id, { score, note: '', hiddenFromCoach: false, trainingId: perSession ? item.training.id : null }));
    setBusy(null);
    if (!res.ok) return;
    const nextOpen = ended.findIndex((x, j) => j > i && !x.mood);
    toast(`Fiilis tallennettu: ${MOOD_LABELS[score]}.`, { action: { label: 'Lisää sanoja', onClick: () => actions.openCheckIn(item.training) }, duration: 5000 });
    if (nextOpen >= 0) setTimeout(() => scrollTo(nextOpen), 250);
  };

  const first = ended[0].training;
  const dayWord = relativeDay(first.date);
  const head = many
    ? `${dayWord === 'Tänään' ? 'Tänään' : dayWord === 'Eilen' ? 'Eilen' : shortDay(first.date)} ${ended.length} treeniä · ${spanLabel(ended)}`
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
          const { theme, name } = sessionLine(state, item.training);
          const day = relativeDay(item.training.date);
          const when = day === 'Tänään' ? `Päättyi klo ${item.end}` : `${day === 'Eilen' ? 'Eilen' : shortDay(item.training.date)} klo ${item.training.time}`;
          return (
            <article key={item.training.id} className={cx('pn-slide', item.mood && 'is-done')} aria-label={`${name} ${item.training.time}`}>
              <div className="eyebrow pn-when">{many ? `Klo ${item.training.time}–${item.end}` : `Treeni ohi · ${when}`}</div>
              <h3 className="pn-title">{item.mood ? `Kiitos! ${MOOD_LABELS[item.mood.score]}` : 'Miten meni?'}</h3>
              <p className="pn-sub">{name}{theme ? ` · ${theme.title}` : ''}</p>
              <MoodPicker value={item.mood?.score ?? null} onChange={(score) => rate(item, i, score)} size="sm" />
              <button type="button" className="pn-link" onClick={() => actions.openCheckIn(item.training)}>
                <Icon name="edit" size={15} /><span>{item.mood?.note ? 'Muokkaa mitä kirjoitit' : 'Kirjoita mitä opit treenissä'}</span>
              </button>
            </article>
          );
        })}
      </div>
      <div className="pn-after-foot">
        {many && <div className="pn-dots" aria-hidden="true">{ended.map((x, i) => <span key={x.training.id} className={cx('pn-dot', i === index && 'is-on', x.mood && 'is-done')} />)}</div>}
        <span className="grow" />
        {many && !allDone && perSession && <Button variant="ghost" size="sm" onClick={() => actions.openCheckIn(null, { all: ended.filter((x) => !x.mood).map((x) => x.training) })}>Kaikista kerralla</Button>}
        {!allDone && onSkip && (
          <button type="button" className="pn-skip" onClick={() => onSkip(ended.filter((x) => !x.mood).map((x) => x.training.id))}>Ohita</button>
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
      <p className="pn-next-what">{name}{theme ? ` · ${theme.title}` : ''}</p>
      <div className="row wrap">
        {absent
          ? <><span className="chip chip-md chip-warn">Ilmoitit poissaolon</span><Button variant="lime" size="sm" onClick={() => actions.openAbsence(next)}>Pääsenkin</Button></>
          : <Button variant="lime" size="sm" icon="close" onClick={() => actions.openAbsence(next)}>En pääse</Button>}
        {plan.items.length > 0 && <Button variant="outline" size="sm" icon="list" className="pn-next-plan" onClick={() => actions.openPlan(next)}>Treenin runko</Button>}
      </div>
      {plan.items.length > 0 && <p className="pn-next-then">{planSummary(plan)}</p>}
      {then && <p className="pn-next-then">Sitten {shortDay(then.date)} klo {then.time} · {sessionLine(state, then).name}</p>}
    </section>
  );
}

/** One tap on a number saves how the player feels right now (no session). */
function FeelingRow() {
  const { state, run, reload } = useData();
  const toast = useToast();
  const student = state.students[0];
  const [busy, setBusy] = useState(false);
  const pick = async (score) => {
    if (busy) return;
    setBusy(true);
    const res = await run(() => api.player.addMood(student.id, { score, note: '', hiddenFromCoach: false, trainingId: null }));
    setBusy(false);
    if (!res.ok) return;
    const fresh = await reload().catch(() => null);
    const mood = fresh?.students?.[0]?.moods?.[0];
    toast(`Fiilis tallennettu: ${MOOD_LABELS[score]}.`, mood ? { action: { label: 'Vain minulle', onClick: () => run(() => api.player.setMoodHidden(mood.id, true), 'Fiilis näkyy vain sinulle.') }, duration: 6000 } : {});
  };
  return (
    <div className="ms-row pn-feel">
      <span className="ms-row-icon"><Icon name="heart" size={16} /></span>
      <span className="ms-row-main"><span className="ms-row-title">Fiilis nyt</span><span className="ms-row-sub">Miltä tuntuu?</span></span>
      <span className="pn-feel-nums" role="radiogroup" aria-label="Fiilis nyt">
        {[1, 2, 3, 4, 5].map((n) => (
          <button key={n} type="button" role="radio" aria-checked={false} aria-label={`${n} ${MOOD_LABELS[n]}`} className="pn-feel-num t-num" data-score={n} disabled={busy} onClick={() => pick(n)}>{n}</button>
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
  const goalSub = [student.goal, ambition && (student.longGoal || ambition.label)].filter(Boolean).join(' · ') || 'Mitä haluat oppia? Mihin tähtäät?';
  const hasAfter = lead.ended.length > 0;
  return (
    <Sheet open={open} onClose={onClose} title="Merkitse" size="md" className="pn-sheet">
      <div className="stack-4">
        {hasAfter
          ? <AfterSessions ended={lead.ended} onSkip={skip} />
          : lead.next && <NextUp next={lead.next} then={lead.then} />}
        {hasAfter && lead.next && (
          <p className="pn-later"><Icon name="calendar" size={14} /> Seuraava: {relativeDay(lead.next.date) === 'Tänään' ? 'tänään' : shortDay(lead.next.date)} klo {lead.next.time} · {sessionLine(state, lead.next).name}</p>
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
          {!hasAfter && <FeelingRow />}
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
