// PlayerScreen — one player from the coach's side: who they are, quick notes, attendance,
// their development timeline, the coach's notes/homework/videos, and roster management.
import { useCallback, useMemo, useState } from 'react';
import { api } from '../api/index.js';
import { useData } from '../app/data.jsx';
import { Link, navigate } from '../app/router.js';
import { Avatar, Button, Card, ChipSelect, Disclosure, EmptyState, Icon, IconButton, Page, Segmented, Sheet, StatTile, TopBar, useConfirm } from '../ui/index.js';
import { Block, Quiet } from '../shared/bits.jsx';
import { Timeline } from '../shared/Timeline.jsx';
import { VideoPlayerSheet } from '../shared/videos.jsx';
import {
  koutsiTrainingsForStudent, koutsiThemeForDate, koutsiGroupById, koutsiMonthlySummary, koutsiFmtShortDate,
} from '../domain/core.js';
import { koutsiFmtEventDate } from '../domain/timeline.js';
import { groupsOf } from '../domain/week.js';
import { LEVELS, MOOD_LABELS } from '../lib/constants.js';
import { useCoach } from './CoachRoot.jsx';
import { groupPath, sessionPath } from './nav.js';
import { AudienceSheet, EditPlaceholderSheet, MergeSheet, PlaceholderInvite, TextEntrySheet } from './playerForms.jsx';
import { useRecord } from './merkitse.jsx';
import { ambitionById } from '../domain/playerNow.js';
import { archiveMap, playerOwnsEvent } from '../domain/archive.js';
import { coachMonthCalendar, playerMonthFacts } from '../domain/glance.js';
import { itemIcon } from '../domain/monthCal.js';
import { ActivityIcon } from '../player/ActivityIcon.jsx';
import { AbsenceSheet } from './AbsencePlanner.jsx';
import { track } from './usage.js';
import { tennisFacts } from '../domain/tennisProfile.js';
import { useMessages } from '../shared/messages/MessagesProvider.jsx';
import { TurnOnSheet } from './MessagesScreen.jsx';
import { threadPath } from './nav.js';

function LevelSheet({ open, onClose, student }) {
  const { run } = useData();
  const set = async (level) => {
    const res = await run(() => api.students.setLevel(student.id, level || null), 'Taso päivitetty.');
    if (res.ok) onClose();
  };
  return (
    <Sheet open={open} onClose={onClose} title="Pelaajan taso" size="sm">
      <ChipSelect options={LEVELS.map((l) => ({ value: l, label: l }))} value={student?.level || ''} onChange={set} layout="grid" columns={2} ariaLabel="Taso" />
    </Sheet>
  );
}

function Notes({ student, onEditNote, onEditHomework, onOpenVideo, onAudience }) {
  const { run } = useData();
  const confirm = useConfirm();
  const removeNote = async (d) => {
    if (await confirm({ title: 'Poista huomio?', message: d.text, confirmLabel: 'Poista', danger: true })) await run(() => api.notes.remove(d.id), 'Huomio poistettu.');
  };
  const removeHomework = async (h) => {
    if (await confirm({ title: 'Poista kotiläksy?', message: h.text, confirmLabel: 'Poista', danger: true })) await run(() => api.homework.remove(h.id), 'Kotiläksy poistettu.');
  };
  const removeVideo = async (v) => {
    if (await confirm({ title: 'Poista video?', message: `${v.title} poistetaan pelaajan näkymästä.`, confirmLabel: 'Poista', danger: true })) await run(() => api.videos.remove(v.id), 'Video poistettu.');
  };
  const toggleHomework = (h) => run(() => api.homework.toggleDone(h.id, !h.done));
  return (
    <div className="stack-5">
      <Block eyebrow="Valmentajalta" title="Huomiot">
        {student.diary.length === 0 ? <Quiet icon="edit">Ei vielä huomioita. Lyhyt huomio treenin jälkeen näkyy pelaajan aikajanalla.</Quiet> : (
          <div className="k-list">
            {student.diary.map((d) => (
              <div key={d.id} className="k-note-row">
                <div className="grow"><p className="k-note-text">{d.text}</p><span className="k-faint">{koutsiFmtEventDate(d.at)}</span></div>
                <IconButton icon="edit" label="Muokkaa" size="sm" onClick={() => onEditNote(d)} />
                <IconButton icon="trash" label="Poista" size="sm" onClick={() => removeNote(d)} />
              </div>
            ))}
          </div>
        )}
      </Block>
      <Block eyebrow="Kotiläksyt" title={`${student.homework.filter((h) => !h.done).length} avoinna`}>
        {student.homework.length === 0 ? <Quiet icon="check-circle">Ei kotiläksyjä.</Quiet> : (
          <div className="k-list">
            {student.homework.map((h) => (
              <div key={h.id} className="k-note-row">
                <button type="button" className={h.done ? 'k-check-btn is-on' : 'k-check-btn'} aria-label={h.done ? 'Merkitse tekemättömäksi' : 'Merkitse tehdyksi'} onClick={() => toggleHomework(h)}><Icon name="check" size={14} strokeWidth={3} /></button>
                <div className="grow"><p className={h.done ? 'k-note-text is-done' : 'k-note-text'}>{h.text}</p><span className="k-faint">{h.done && h.doneAt ? `Tehty ${koutsiFmtEventDate(h.doneAt)}` : koutsiFmtEventDate(h.at)}</span></div>
                <IconButton icon="edit" label="Muokkaa" size="sm" onClick={() => onEditHomework(h)} />
                <IconButton icon="trash" label="Poista" size="sm" onClick={() => removeHomework(h)} />
              </div>
            ))}
          </div>
        )}
      </Block>
      <Block eyebrow="Videot" title={`${student.videos.length} videota`}>
        {student.videos.length === 0 ? <Quiet icon="play">Ei videoita.</Quiet> : (
          <div className="k-list">
            {student.videos.map((v) => (
              <div key={v.id} className="k-note-row">
                <button type="button" className="k-video-thumb" style={{ '--h': v.hue }} onClick={() => onOpenVideo(v)} aria-label={`Katso ${v.title}`}><Icon name="play" size={14} /></button>
                <div className="grow"><p className="k-note-text">{v.title}</p><span className="k-faint">{v.addedBy === 'player' ? 'Pelaajan oma' : `Jaettu ${v.recipientIds.length} pelaajalle`}, {koutsiFmtShortDate(v.date)}</span></div>
                {v.addedBy !== 'player' && <IconButton icon="users" label="Kuka näkee" size="sm" onClick={() => onAudience(v)} />}
                {v.addedBy !== 'player' && <IconButton icon="trash" label="Poista" size="sm" onClick={() => removeVideo(v)} />}
              </div>
            ))}
          </div>
        )}
      </Block>
    </div>
  );
}

// The player's goal on top of their Kehitys: what they are after now, and (when the player has
// told) what kind of player they aim to be and where they are heading in the long run. Each earlier goal stays on
// the timeline below as "Tavoite päivitetty" with the old one underneath.
function PlayerGoal({ student }) {
  const history = student.goalHistory || [];
  const earlier = history.filter((h) => h.previousValue).length;
  const foot = [
    history[0] ? `Asetettu ${koutsiFmtEventDate(history[0].at)}` : '',
    earlier === 1 ? '1 aiempi tavoite aikajanalla' : earlier > 1 ? `${earlier} aiempaa tavoitetta aikajanalla` : '',
  ].filter(Boolean).join(', ');
  return (
    <Card className="goal-card">
      <div className="eyebrow"><Icon name="target" size={13} /> Pelaajan tavoite</div>
      {student.goal ? <p className="goal-text">{student.goal}</p> : <p className="k-faint">Pelaaja ei ole vielä asettanut tavoitetta.</p>}
      {(student.ambition || student.longGoal) && (
        <div className="goal-long">
          {ambitionById(student.ambition) && <span className="chip chip-sm goal-aim">{ambitionById(student.ambition).label}</span>}
          {student.longGoal && <p className="goal-long-text"><span className="k-faint">Pitkällä aikavälillä:</span> {student.longGoal}</p>}
        </div>
      )}
      {student.goal && foot && <span className="goal-card-foot">{foot}</span>}
    </Card>
  );
}

const cx = (...c) => c.filter(Boolean).join(' ');
const WEEKDAYS = ['Ma', 'Ti', 'Ke', 'To', 'Pe', 'La', 'Su'];
const dec = (x) => (x == null ? '–' : x.toFixed(1).replace('.', ','));
const MONTHS_SHORT = ['tammi', 'helmi', 'maalis', 'huhti', 'touko', 'kesä', 'heinä', 'elo', 'syys', 'loka', 'marras', 'joulu'];
/** "Marialle", "Emilille": the name a button speaks to. */

function DayIcon({ item, size = 15 }) {
  if (item.kind === 'absent') return <Icon name="close" size={size - 2} strokeWidth={3} />;
  if (item.kind === 'own' || item.kind === 'coach') return <ActivityIcon activity={item.activity} size={size} />;
  return <Icon name={itemIcon(item)} size={size} />;
}

// EHDOTUS (haara koutsi-selkeys): the player's month at one glance, the same for every coach of
// the player — four numbers (attendance, training days a week with last month beside it, own
// trainings, feeling) and the month as a calendar: lime = a session they were at, dark = their own
// training or match, clay = a session they missed. Tap a day for what it held.
function MonthCard({ state, student, hidden }) {
  const now = new Date();
  const [ym, setYm] = useState({ year: now.getFullYear(), month: now.getMonth() });
  const [picked, setPicked] = useState(null);
  const cal = useMemo(() => coachMonthCalendar(state, student, ym.year, ym.month, { hidden, now }), [state, student, ym, hidden]); // eslint-disable-line react-hooks/exhaustive-deps
  const facts = useMemo(() => playerMonthFacts(state, student, ym.year, ym.month, now), [state, student, ym]); // eslint-disable-line react-hooks/exhaustive-deps
  const isCurrent = ym.year === now.getFullYear() && ym.month === now.getMonth();
  const shift = (n) => {
    setPicked(null);
    setYm(({ year, month }) => { const d = new Date(year, month + n, 1); return { year: d.getFullYear(), month: d.getMonth() }; });
  };
  const days = cal.weeks.flat();
  const lastDone = [...days].reverse().find((d) => d.inMonth && d.items.length);
  const day = days.find((d) => d.date === picked) || lastDone || null;
  const { current: c, previous: p } = facts;
  const prevName = MONTHS_SHORT[(ym.month + 11) % 12];
  const trend = p.perWeek > 0 ? (c.perWeek > p.perWeek + 0.2 ? 'up' : c.perWeek < p.perWeek - 0.2 ? 'down' : 'same') : null;
  const kindOf = (d) => {
    const k = new Set(d.items.map((x) => x.kind));
    if (k.has('coach')) return 'is-coach';
    if (k.has('own') || k.has('match') || k.has('tournament')) return 'is-own';
    if (k.has('entry')) return 'is-entry';
    if (k.has('absent')) return 'is-absent';
    return '';
  };
  return (
    <Card className="pc-month">
      <div className="pc-month-nav">
        <IconButton icon="chevron-left" label="Edellinen kuukausi" size="sm" onClick={() => shift(-1)} />
        <span className="pc-month-name">{cal.label}</span>
        <IconButton icon="chevron-right" label="Seuraava kuukausi" size="sm" disabled={isCurrent} onClick={() => shift(1)} />
      </div>
      <div className="pc-facts">
        <div className="pc-fact">
          <span className="pc-fact-num t-num">{c.rate == null ? '–' : `${c.rate} %`}</span>
          <span className="pc-fact-label">läsnä</span>
          <span className="pc-fact-sub t-num">{c.held ? `${c.present}/${c.held} treeniä` : 'ei treenejä'}</span>
        </div>
        <div className="pc-fact">
          <span className="pc-fact-num t-num">{dec(c.perWeek)}</span>
          <span className="pc-fact-label">kertaa viikossa</span>
          <span className={cx('pc-fact-sub', trend && `is-${trend}`)}>
            {trend === 'up' && <Icon name="arrow-up-right" size={12} strokeWidth={2.6} />}{p.perWeek > 0 ? `${prevName}kuussa ${dec(p.perWeek)}` : 'treenit ja omat'}
          </span>
        </div>
        <div className="pc-fact">
          <span className="pc-fact-num t-num">{c.own}</span>
          <span className="pc-fact-label">omaa treeniä</span>
          <span className="pc-fact-sub">lenkit, sali, ottelut</span>
        </div>
        <div className="pc-fact">
          <span className="pc-fact-num t-num">{dec(c.moodAverage)}</span>
          <span className="pc-fact-label">fiilis</span>
          <span className="pc-fact-sub">{c.moods ? `${c.moods} merkintää` : 'ei merkintöjä'}</span>
        </div>
      </div>
      <div className="mc-grid pc-grid" role="grid" aria-label={cal.label}>
        {WEEKDAYS.map((w) => <span key={w} className="mc-wd" role="columnheader">{w}</span>)}
        {days.map((d) => {
          const first = d.items.find((x) => x.kind !== 'absent') || d.items[0];
          const both = d.items.some((x) => x.kind === 'coach') && d.items.some((x) => x.kind === 'own' || x.kind === 'match');
          return (
            <button key={d.date} type="button" role="gridcell" disabled={!d.inMonth}
              className={cx('pc-day', !d.inMonth && 'is-out', kindOf(d), d.isToday && 'is-today', d.isFuture && 'is-future', day?.date === d.date && 'is-picked')}
              onClick={() => setPicked(d.date)} aria-label={`${d.day}. ${d.items.length ? d.items.map((x) => `${x.title}${x.kind === 'absent' ? ' (poissa)' : ''}`).join(', ') : 'ei merkintöjä'}`}>
              <span className="pc-day-num t-num">{d.inMonth ? d.day : ''}</span>
              {first && <span className="pc-day-icon"><DayIcon item={first} /></span>}
              {both && <span className="pc-day-dot" aria-hidden="true" />}
            </button>
          );
        })}
      </div>
      <div className="pc-legend" aria-hidden="true">
        <span><i className="pc-sw is-coach" />Valmennus</span>
        <span><i className="pc-sw is-own" />Oma treeni</span>
        <span><i className="pc-sw is-absent" />Poissa</span>
      </div>
      {day && (
        <section className="mc-dayinfo" aria-label={koutsiFmtShortDate(day.date)}>
          <div className="eyebrow">{koutsiFmtShortDate(day.date)}</div>
          {day.items.length === 0 ? <p className="k-quiet-text">Ei merkintöjä tältä päivältä.</p> : (
            <ul className="mc-items">
              {day.items.map((x) => {
                // a session (or a missed one) opens its group; a session without a group opens itself
                const to = x.groupId ? groupPath(x.groupId) : x.trainingId ? sessionPath(x.trainingId) : null;
                const body = (
                  <>
                    <span className="mc-item-icon"><DayIcon item={x} size={16} /></span>
                    <span className="mc-item-main">
                      <span className="mc-item-title">{x.title}</span>
                      {x.sub && <span className="mc-item-sub">{x.sub}</span>}
                    </span>
                    {x.time && <span className="mc-item-time t-num">{x.time}</span>}
                    {to && <Icon name="chevron-right" size={16} className="mc-item-go" />}
                  </>
                );
                return (
                  <li key={`${x.key}-${day.date}`} className={cx('mc-item', `is-${x.kind}`, to && 'is-link')}>
                    {to ? <Link to={to} className="mc-item-link" aria-label={`${x.groupId ? 'Avaa ryhmä' : 'Avaa treeni'} ${x.title}`}>{body}</Link> : body}
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      )}
    </Card>
  );
}

function Details({ state, student, onReplyWish }) {
  const now = new Date();
  const month = koutsiMonthlySummary(state, student.id, now.getFullYear(), now.getMonth());
  const moods = student.moods || [];
  const avg = moods.length ? (moods.reduce((s, m) => s + m.score, 0) / moods.length).toFixed(1) : '–';
  const field = (label, value, empty) => (
    <div className="k-detail">
      <div className="field-label">{label}</div>
      {value ? <p className="k-note-text">{value}</p> : <p className="k-faint">{empty}</p>}
    </div>
  );
  return (
    <div className="stack-5">
      <Card className="stack-4">
        {field('Tavoite', student.goal, 'Pelaaja ei ole vielä asettanut tavoitetta.')}
        {field('Toive seuraavalle kerralle', student.playerWish, 'Ei toivetta.')}
        {student.playerWish && onReplyWish && (
          <button type="button" className="k-textlink an-reply" onClick={onReplyWish}><Icon name="chat" size={15} />Vastaa toiveeseen viestillä</button>
        )}
        {field('Pelaajan kommentti', student.playerNote, 'Ei kommenttia.')}
      </Card>
      <div className="k-stats k-stats-3">
        <StatTile label="Treenit tässä kuussa" value={month.categories.find((c) => c.key === 'ryhmatreeni').count + month.categories.find((c) => c.key === 'valmennus').count} />
        <StatTile label="Omat treenit" value={month.categories.filter((c) => ['omatoiminen', 'fysiikka', 'muu', 'turnaus'].includes(c.key)).reduce((s, c) => s + c.count, 0)} />
        <StatTile label="Fiilis ka." value={avg} sub={moods.length ? `${moods.length} merkintää` : 'ei merkintöjä'} />
      </div>
      {moods.length > 0 && (
        <Block eyebrow="Fiilikset" title="Viimeisimmät">
          <div className="k-moods">
            {moods.slice(0, 8).map((m) => (
              <div key={m.id} className="k-mood" title={MOOD_LABELS[m.score]}>
                <span className="k-mood-score t-num" data-score={m.score}>{m.score}</span>
                <span className="k-faint">{koutsiFmtEventDate(m.at)}</span>
              </div>
            ))}
          </div>
        </Block>
      )}
    </div>
  );
}

const tabByPlayer = new Map(); // back from a linked page comes back to the same tab

export function PlayerScreen({ params }) {
  const { state, run } = useData();
  const { coachId, acting } = useCoach();
  const record = useRecord();
  const msgs = useMessages();
  const [turnOnOpen, setTurnOnOpen] = useState(false);
  const confirm = useConfirm();
  const [tab, setTabState] = useState(() => tabByPlayer.get(params.id) || 'kehitys');
  const setTab = (v) => { tabByPlayer.set(params.id, v); setTabState(v); };
  const [sheet, setSheet] = useState(null); // { kind, item }
  const [video, setVideo] = useState(null);
  const student = state.students.find((s) => s.id === params.id);
  const trainings = useMemo(() => (student ? koutsiTrainingsForStudent(state, student.id).map((t) => {
    const group = t.groupId ? koutsiGroupById(state, t.groupId) : null;
    return { ...t, groupName: group?.name || '', themeTitle: group ? koutsiThemeForDate(group, t.date)?.title || '' : '' };
  }) : []), [state, student]);
  // What the player archived from their own Kehitys and made themselves is theirs alone now
  // (domain/archive.js); the coach's own notes, homework and sessions stay in view.
  const archive = useMemo(() => archiveMap(student?.archive), [student?.archive]);
  const isHidden = useCallback((e) => archive.has(e.id) && playerOwnsEvent(e), [archive]);
  const hiddenKeys = useMemo(() => new Set(archive.keys()), [archive]);
  if (!student) {
    return (
      <>
        <TopBar title="Pelaaja" back="/valmentaja/pelaajat" />
        <Page><EmptyState art="search" title="Pelaajaa ei löytynyt" text="Valmennus on ehkä päättynyt, tai pelaaja on yhdistetty toiseen." /></Page>
      </>
    );
  }
  const groups = groupsOf(state, student.id);
  const close = () => setSheet(null);
  const messagesOn = msgs.ready && msgs.enabled && !acting;
  const thread = messagesOn ? msgs.byStudent(student.id) : null;
  const openMessage = () => {
    track('pelaaja.viesti');
    if (thread?.enabled) navigate(threadPath(student.id));
    else setTurnOnOpen(true);
  };

  const endCoaching = async () => {
    const twin = state.students.find((s) => s.id !== student.id && s.name.trim().toLocaleLowerCase('fi') === student.name.trim().toLocaleLowerCase('fi'));
    const ok = await confirm({
      title: `Päätä valmennus: ${student.name}?`,
      message: twin
        ? `Pelaaja poistuu listaltasi ja KAIKISTA ryhmistäsi. Sinulla on toinenkin pelaaja nimeltä ${twin.name} — jos tämä on sama henkilö, yhdistä profiilit sen sijaan, niin kumpikaan ryhmä ei katoa.`
        : 'Pelaaja poistuu listaltasi ja ryhmistäsi. Hänen omat tietonsa ja aiemmat merkinnät säilyvät hänen näkymässään.',
      confirmLabel: 'Päätä valmennus', danger: true,
    });
    if (!ok) return;
    const res = await run(() => api.students.endCoaching(coachId, student.id), 'Valmennus päättyi.');
    if (res.ok) navigate('/valmentaja/pelaajat', { replace: true });
  };
  const deletePlayer = async () => {
    const ok = await confirm({
      title: `Poista ${student.name} kokonaan?`,
      message: `${student.name} ja kaikki hänen tietonsa — ryhmät, treenit, huomiot, läksyt ja videot — poistetaan pysyvästi. Toimintoa ei voi perua.`,
      confirmLabel: 'Poista lopullisesti', danger: true, typeToConfirm: student.name,
    });
    if (!ok) return;
    const res = await run(() => api.students.deletePlaceholder(coachId, student.id), `${student.name} poistettiin.`);
    if (res.ok) navigate('/valmentaja/pelaajat', { replace: true });
  };

  return (
    <>
      <TopBar title={student.name} back="/valmentaja/pelaajat" actions={student.isPlaceholder ? <IconButton icon="edit" label="Muokkaa perustietoja" onClick={() => setSheet({ kind: 'edit' })} /> : null} />
      <Page className="stack-6 k-page-pad">
        <header className="k-player-head">
          <Avatar person={student} size={72} ring />
          <div className="grow">
            <h1 className="t-title">{student.name}</h1>
            <div className="row wrap k-player-meta">
              {student.ageLabel && <span>{student.ageLabel}</span>}
              <button type="button" className="chip chip-md chip-lime k-level-btn" onClick={() => setSheet({ kind: 'level' })}>{student.level || 'Aseta taso'}<Icon name="chevron-down" size={13} /></button>
              {ambitionById(student.ambition) && <span className="chip chip-md pc-aim"><Icon name="target" size={13} />{ambitionById(student.ambition).label}</span>}
            </div>
            {groups.length > 0 && (
              <div className="row wrap k-player-groups">
                {groups.map((g) => <Link key={g.id} to={groupPath(g.id)} className="k-group-pill"><span className="t-num">{g.day} {g.time}</span><span className="truncate">{g.name}</span></Link>)}
              </div>
            )}
            {/* the player's own words and tennis profile (only the player writes these) */}
            {tennisFacts(student).length > 0 && (
              <div className="row wrap k-player-facts">{tennisFacts(student).map((t) => <span key={t} className="chip chip-sm chip-neutral">{t}</span>)}</div>
            )}
            {student.bio && <p className="k-player-bio">{student.bio}</p>}
            {student.tennisStory && <p className="k-player-bio k-player-story"><span className="k-player-story-label">Tennistausta</span>{student.tennisStory}</p>}
          </div>
        </header>

        {student.isPlaceholder && <PlaceholderInvite student={student} />}

        {/* Like the old app's "+ Päiväkirja" / "+ Kotiläksy": the plain form for just this player
            (RecordSheet with the player as its scope), as tiles: Huomio · Kotiläksy · Video (· Viesti) · Poissaolot */}
        <div className={cx('k-player-actions is-tiles', messagesOn ? 'is-five' : 'is-four')}>
          <Button variant="lime" size="lg" icon="chat" onClick={() => record.open('note', { ids: [student.id], source: 'pelaaja', scope: { name: student.name, icon: 'user' } })}>Huomio</Button>
          <Button variant="outline" size="lg" icon="check-circle" onClick={() => record.open('homework', { ids: [student.id], source: 'pelaaja', scope: { name: student.name, icon: 'user' } })}>Kotiläksy</Button>
          <Button variant="outline" size="lg" icon="play" onClick={() => record.open('video', { ids: [student.id], source: 'pelaaja', scope: { name: student.name, icon: 'user' } })}>Video</Button>
          {messagesOn && <Button variant="outline" size="lg" icon="send" onClick={openMessage}>Viesti</Button>}
          <Button variant="outline" size="lg" icon="calendar" onClick={() => { track('pelaaja.poissaolot'); setSheet({ kind: 'absence' }); }}>Poissaolot</Button>
        </div>

        <MonthCard state={state} student={student} hidden={hiddenKeys} />

        <PlayerGoal student={student} />

        <Segmented ariaLabel="Näkymä" value={tab} onChange={setTab} options={[
          { value: 'kehitys', label: 'Kehitys' },
          { value: 'merkinnat', label: 'Merkinnät' },
          { value: 'tiedot', label: 'Tiedot' },
        ]} />
        {tab === 'kehitys' && (
          <div className="stack-4">
            <Timeline viewer="coach" student={student} trainings={trainings} clubEvents={state.clubEvents} onOpenVideo={setVideo} isHidden={isHidden}
              emptyText="Aikajanalle kertyvät treenit teemoineen, huomiosi, läksyt ja pelaajan omat merkinnät." />
          </div>
        )}
        {tab === 'merkinnat' && (
          <Notes student={student}
            onEditNote={(d) => setSheet({ kind: 'note', item: d })}
            onEditHomework={(h) => setSheet({ kind: 'homework', item: h })}
            onOpenVideo={setVideo}
            onAudience={(v) => setSheet({ kind: 'audience', item: v })} />
        )}
        {tab === 'tiedot' && <Details state={state} student={student} onReplyWish={messagesOn && thread?.enabled && !student.isPlaceholder && (student.wishHistory || [])[0] ? () => { track('pelaaja.vastaa-toiveeseen'); navigate(threadPath(student.id, { kind: 'wish', id: student.wishHistory[0].id })); } : null} />}

        <Disclosure title="Hallinta" summary="Valmennuksen päättäminen, yhdistäminen" icon="settings">
          <div className="stack-3">
            <p className="field-msg">Päättäminen poistaa pelaajan listaltasi ja ryhmistäsi. Aiemmat merkinnät säilyvät pelaajan omassa näkymässä.</p>
            <div className="row wrap">
              <Button variant="outline" size="sm" icon="users" onClick={() => setSheet({ kind: 'merge' })}>Yhdistä toiseen pelaajaan</Button>
              <Button variant="danger" size="sm" onClick={endCoaching}>Päätä valmennus</Button>
              {student.isPlaceholder && <Button variant="danger" size="sm" icon="trash" onClick={deletePlayer}>Poista kokonaan</Button>}
            </div>
          </div>
        </Disclosure>
      </Page>

      <LevelSheet open={sheet?.kind === 'level'} student={student} onClose={close} />
      {messagesOn && <TurnOnSheet open={turnOnOpen} onClose={() => setTurnOnOpen(false)} student={student} onOn={() => navigate(threadPath(student.id))} />}
      <AbsenceSheet open={sheet?.kind === 'absence'} student={student} onClose={close} />
      <EditPlaceholderSheet open={sheet?.kind === 'edit'} student={student} onClose={close} />
      <MergeSheet open={sheet?.kind === 'merge'} student={student} onClose={close} />
      <AudienceSheet open={sheet?.kind === 'audience'} video={sheet?.item} onClose={close} />
      {/* new notes, homework and videos go through Merkitse's sheets (useRecord); these edit one */}
      <TextEntrySheet
        open={sheet?.kind === 'note'} onClose={close}
        title="Muokkaa huomiota"
        subtitle="Näkyy pelaajan aikajanalla."
        initial={sheet?.item?.text} placeholder="Esim. Hyvä nousu syötössä tällä viikolla…"
        onSave={async (text) => (await run(() => api.notes.update(sheet.item.id, text), 'Huomio päivitetty.')).ok}
      />
      <TextEntrySheet
        open={sheet?.kind === 'homework'} onClose={close}
        title="Muokkaa kotiläksyä"
        subtitle="Pelaaja voi merkitä läksyn tehdyksi omassa näkymässään."
        initial={sheet?.item?.text} placeholder="Esim. 20 rystylyöntiä seinää vasten…"
        onSave={async (text) => (await run(() => api.homework.update(sheet.item.id, text), 'Kotiläksy päivitetty.')).ok}
      />
      <VideoPlayerSheet video={video} onClose={() => setVideo(null)} />
    </>
  );
}
