// boardSheets.jsx — Viikkohallinta's pop-ups: the plus menu (Ryhmä · Treeni · Tapahtuma · Teema,
// and many groups and players at once), what a tap on a session block opens (where it stands,
// the fix for anything missing, attendance, a note / homework / video for its players, move,
// remove, open the group), and the month grid for jumping to another week.
import { useMemo, useState } from 'react';
import { useData } from '../app/data.jsx';
import { navigate } from '../app/router.js';
import { Icon, IconButton, Sheet } from '../ui/index.js';
import { koutsiPad, koutsiTimeRangeLabel, koutsiTodayStr, koutsiClubEventsOnDate, KOUTSI_MONTHS } from '../domain/core.js';
import { presentPlayerIds, sessionRoster, weekDates } from '../domain/week.js';
import { planSummary, readPlan } from '../domain/plan.js';
import { groupPath, playerPath, sessionPath } from './nav.js';
import { GroupThemeSheet } from './GroupThemeSheet.jsx';
import { AddMembersSheet, ExtendCalendarSheet } from './groupForms.jsx';
import { TrainingSheet, useTrainingDelete } from './trainingForms.jsx';
import { useRecord } from './merkitse.jsx';
import { track } from './usage.js';

const cx = (...c) => c.filter(Boolean).join(' ');
const DAY_LONG = ['Maanantai', 'Tiistai', 'Keskiviikko', 'Torstai', 'Perjantai', 'Lauantai', 'Sunnuntai'];
const dayMonth = (date) => `${Number(date.slice(8))}.${Number(date.slice(5, 7))}.`;
const weekdayOf = (date) => DAY_LONG[(new Date(`${date}T12:00:00`).getDay() + 6) % 7];
const forPlayers = (n) => (n === 1 ? '1 pelaajalle' : `${n} pelaajalle`);

function Tile({ icon, tone, title, sub, onClick }) {
  return (
    <button type="button" className="k-merkitse-tile ms-tile" onClick={onClick}>
      <span className={cx('k-merkitse-icon', `is-${tone}`)}><Icon name={icon} size={22} /></span>
      <span className="k-merkitse-title">{title}</span>
      <span className="k-merkitse-sub">{sub}</span>
    </button>
  );
}

function Rows({ title = 'Muut', rows }) {
  if (!rows.length) return null;
  return (
    <section className="ms-others" aria-label={title}>
      <div className="eyebrow">{title}</div>
      <div className="ms-others-list">
        {rows.map((r) => (
          <button key={r.id} type="button" className={cx('ms-row', r.danger && 'is-danger')} onClick={r.run}>
            <span className="ms-row-icon"><Icon name={r.icon} size={16} /></span>
            <span className="ms-row-main"><span className="ms-row-title">{r.title}</span>{r.sub && <span className="ms-row-sub">{r.sub}</span>}</span>
            <Icon name="chevron-right" size={16} className="k-chevron" />
          </button>
        ))}
      </div>
    </section>
  );
}

/** The plus button's menu: the same tiles-and-rows shape as Merkitse. */
export function AddSheet({ open, onClose, onPick, week }) {
  return (
    <Sheet open={open} onClose={onClose} title="Mitä lisätään?" size="md">
      <div className="stack-4">
        <div className="ms-grid">
          <Tile icon="users" tone="lime" title="Ryhmä" sub="Viikoittaiset treenit kalenteriin" onClick={() => onPick('ryhma')} />
          <Tile icon="sparkles" tone="sand" title="Teema" sub={`Viikon ${week.week} teema usealle ryhmälle`} onClick={() => onPick('teema')} />
          <Tile icon="calendar-plus" tone="blue" title="Treeni" sub="Yksittäinen treeni tai yksityistunti" onClick={() => onPick('treeni')} />
          <Tile icon="flag" tone="clay" title="Tapahtuma" sub="Kilpailu, leiri tai seuran tapahtuma" onClick={() => onPick('tapahtuma')} />
        </div>
        <Rows rows={[{ id: 'monta', icon: 'list', title: 'Monta ryhmää ja pelaajaa kerralla', sub: 'Koko kauden ryhmät ja pelaajat yhdellä kertaa', run: () => onPick('monta') }]} />
      </div>
    </Sheet>
  );
}

const ISSUE_TEXT = {
  theme: ['Pelaajat eivät näe tämän viikon teemaa.', 'Aseta teema', 'theme'],
  players: ['Ryhmässä ei ole vielä pelaajia.', 'Lisää pelaajia', 'members'],
  last: ['Tämä on ryhmän viimeinen treeni kalenterissa.', 'Jatka kalenteria', 'extend'],
  ended: ['Ryhmän treenit ovat loppuneet kalenterista.', 'Jatka kalenteria', 'extend'],
  none: ['Ryhmällä ei ole treenejä kalenterissa.', 'Jatka kalenteria', 'extend'],
};

/** A tap on a block: where the session stands and everything that can be done for it. */
export function BoardItemSheet({ open, item, week, onClose }) {
  const { state } = useData();
  const record = useRecord();
  const removeTraining = useTrainingDelete();
  const [sub, setSub] = useState(null); // { kind: 'theme' | 'members' | 'extend' | 'edit' | 'add', group?, training?, date?, time? }
  const closeSub = () => setSub(null);
  const subs = (
    <>
      <GroupThemeSheet open={sub?.kind === 'theme'} group={sub?.group} week={week} onClose={closeSub} />
      <AddMembersSheet open={sub?.kind === 'members'} group={sub?.group} onClose={closeSub} />
      <ExtendCalendarSheet open={sub?.kind === 'extend'} groups={sub?.group ? [sub.group] : []} onClose={closeSub} />
      <TrainingSheet open={sub?.kind === 'edit' || sub?.kind === 'add'} editing={sub?.kind === 'edit' ? sub.training : null}
        defaultDate={sub?.date} defaultGroupId={sub?.group?.id} defaultTime={sub?.time} onClose={closeSub} />
    </>
  );
  if (!item) return subs;
  const { group, student, training, tone, issues, theme } = item;
  // the live training (attendance changes while the sheet is open)
  const live = training ? state.trainings.find((t) => t.id === training.id) || training : null;
  const livePlan = readPlan(live?.notes);
  const name = group?.name || student?.name || training?.type || 'Treeni';
  const time = koutsiTimeRangeLabel(item.time, item.durationMinutes);
  const then = (fn) => () => { onClose(); fn(); };
  const action = (kind) => then(() => setSub({ kind, group, training: live, date: item.date, time: item.time }));

  const roster = live ? sessionRoster(state, live) : [];
  const absent = live ? (live.absences || []).length : 0;
  const ids = !live ? [] : item.status === 'upcoming' ? roster.map((s) => s.id) : presentPlayerIds(state, live);
  const recordFor = (kind) => then(() => record.open(kind, { ids, source: 'viikko' }));

  let status;
  if (issues.length) {
    status = (
      <div className="wb-status is-issue">
        {issues.map((i) => {
          const [text, fix, kind] = ISSUE_TEXT[i.id];
          return (
            <div key={i.id} className="wb-status-row">
              <Icon name="alert" size={18} className="wb-status-icon" />
              <span className="grow"><strong>{i.label}</strong><span className="wb-status-text">{text}</span></span>
              <button type="button" className="wb-status-fix" onClick={action(kind)}>{fix}</button>
            </div>
          );
        })}
      </div>
    );
  } else if (item.kind === 'missing') {
    status = (
      <div className="wb-status is-missing">
        <Icon name="calendar" size={18} className="wb-status-icon" />
        <span className="grow"><strong>Ei treeniä tällä viikolla</strong><span className="wb-status-text">Ryhmän tavallinen aika on {group.day} {group.time}. Lisää treeni, jos tällä viikolla pelataan.</span></span>
      </div>
    );
  } else if (tone === 'past') {
    status = (
      <div className="wb-status is-past">
        <Icon name="check-circle" size={18} className="wb-status-icon" />
        <span className="grow"><strong>Pidetty</strong><span className="wb-status-text">{roster.length ? `${roster.length - absent}/${roster.length} paikalla` : 'Ei pelaajia'}{theme ? ` · teema ${theme.title}` : ''}</span></span>
      </div>
    );
  } else {
    status = (
      <div className="wb-status is-ok">
        <Icon name="check-circle" size={18} className="wb-status-icon" />
        <span className="grow"><strong>Kaikki kunnossa</strong><span className="wb-status-text">{theme ? `Teema: ${theme.title}` : training?.type || 'Yksityistunti'}</span></span>
      </div>
    );
  }

  const facts = [
    group ? `${group.memberIds.length} pelaajaa` : null,
    group?.level || null,
    live && live.type !== 'Ryhmätreeni' ? live.type : null,
    absent ? `${absent} poissa` : null,
  ].filter(Boolean);

  const rows = item.kind === 'missing' ? [
    { id: 'lisaa', icon: 'calendar-plus', title: 'Lisää treeni tälle päivälle', sub: `${weekdayOf(item.date)} ${dayMonth(item.date)} klo ${item.time}`, run: action('add') },
    { id: 'ryhma', icon: 'users', title: 'Avaa ryhmä', sub: name, run: then(() => navigate(groupPath(group.id))) },
  ] : [
    live && { id: 'runko', icon: 'list', title: 'Treenin runko', sub: livePlan.items.length ? planSummary(livePlan) : 'Valitse harjoitteet pankista',
      run: then(() => { track('viikko.runko'); navigate(`${sessionPath(live.id)}?runko=1`); }) },
    group && theme && { id: 'teema', icon: 'sparkles', title: 'Vaihda teema', sub: theme.title, run: action('theme') },
    { id: 'muokkaa', icon: 'edit', title: 'Muokkaa treeniä', sub: 'Siirrä toiseen aikaan tai päivään', run: action('edit') },
    group && { id: 'ryhma', icon: 'users', title: 'Avaa ryhmä', sub: name, run: then(() => navigate(groupPath(group.id))) },
    student && { id: 'pelaaja', icon: 'user', title: 'Avaa pelaaja', sub: student.name, run: then(() => navigate(playerPath(student.id))) },
    { id: 'poista', icon: 'trash', title: 'Poista treeni', sub: 'Pelaajat saavat ilmoituksen peruutuksesta', danger: true,
      run: then(() => removeTraining(live, `${dayMonth(item.date)} klo ${item.time} — ${name}`)) },
  ].filter(Boolean);

  return (
    <>
      <Sheet open={open} onClose={onClose} title={name} subtitle={`${weekdayOf(item.date)} ${dayMonth(item.date)} · ${time}`} size="md">
        <div className="stack-4">
          {status}
          {facts.length > 0 && <div className="wb-facts">{facts.map((f) => <span key={f} className="wb-fact">{f}</span>)}</div>}
          {live && roster.length > 0 && (
            <div className="ms-grid">
              <Tile icon="user-check" tone="sand" title="Läsnäolo"
                sub={item.status === 'upcoming' ? (absent ? `${absent} ilmoitti poissaolon` : `${roster.length} pelaajaa`) : `${roster.length - absent}/${roster.length} paikalla`}
                onClick={then(() => { track('viikko.lasnaolo'); navigate(sessionPath(live.id)); })} />
              <Tile icon="chat" tone="blue" title="Huomio" sub={forPlayers(ids.length)} onClick={recordFor('note')} />
              <Tile icon="check-circle" tone="green" title="Kotiläksy" sub={forPlayers(ids.length)} onClick={recordFor('homework')} />
              <Tile icon="play" tone="clay" title="Video" sub={forPlayers(ids.length)} onClick={recordFor('video')} />
            </div>
          )}
          <Rows rows={rows} />
        </div>
      </Sheet>
      {subs}
    </>
  );
}

/** Tap the week's dates: a month grid (sessions per day) to jump to any week. */
export function WeekPickerSheet({ open, week, onClose, onPick }) {
  const { state } = useData();
  const monday = weekDates(week)[0];
  const [cursor, setCursor] = useState(null);
  const y = cursor?.y ?? Number(monday.slice(0, 4));
  const m = cursor?.m ?? Number(monday.slice(5, 7)) - 1;
  const move = (n) => { const d = new Date(y, m + n, 1); setCursor({ y: d.getFullYear(), m: d.getMonth() }); };
  const inWeek = new Set(weekDates(week));
  const today = koutsiTodayStr();
  const prefix = `${y}-${koutsiPad(m + 1)}`;
  const counts = useMemo(() => {
    const map = new Map();
    for (const t of state.trainings) if (t.loggedBy !== 'player' && t.date.startsWith(prefix)) map.set(t.date, (map.get(t.date) || 0) + 1);
    return map;
  }, [state.trainings, prefix]);
  const lead = (new Date(y, m, 1).getDay() + 6) % 7;
  const days = new Date(y, m + 1, 0).getDate();
  // Always six rows: a 5-row month must not shrink the sheet when you page through months.
  const cells = [...Array(lead).fill(null), ...Array.from({ length: days }, (_, i) => `${prefix}-${koutsiPad(i + 1)}`)];
  while (cells.length < 42) cells.push(null);
  const monthName = KOUTSI_MONTHS[m];
  return (
    <Sheet open={open} onClose={() => { setCursor(null); onClose(); }} title="Siirry viikkoon" size="sm">
      <div className="cal-month">
        <div className="cal-month-head">
          <IconButton icon="chevron-left" label="Edellinen kuukausi" variant="soft" onClick={() => move(-1)} />
          <span className="cal-month-title">{monthName.charAt(0).toUpperCase() + monthName.slice(1)} {y}</span>
          <IconButton icon="chevron-right" label="Seuraava kuukausi" variant="soft" onClick={() => move(1)} />
        </div>
        <div className="cal-grid" role="grid">
          {['Ma', 'Ti', 'Ke', 'To', 'Pe', 'La', 'Su'].map((d) => <span key={d} className="cal-dow">{d}</span>)}
          {cells.map((date, i) => {
            if (!date) return <span key={`e${i}`} className="cal-blank" aria-hidden="true" />;
            const n = counts.get(date) || 0;
            const ev = koutsiClubEventsOnDate(state, date).length;
            return (
              <button key={date} type="button" className={cx('cal-cell', date === today && 'is-today', inWeek.has(date) && 'is-week', n > 0 && 'has-sessions')}
                onClick={() => { setCursor(null); onPick(date); }}>
                <span className="cal-cell-num">{Number(date.slice(8))}</span>
                {(n > 0 || ev > 0) && <span className="cal-cell-count">{n > 0 ? n : ''}{ev > 0 ? <Icon name="flag" size={9} /> : null}</span>}
              </button>
            );
          })}
        </div>
      </div>
    </Sheet>
  );
}
