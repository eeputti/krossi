// AbsencePlanner — one player away from many coming sessions at once ("Lumi on lomalla kaksi
// viikkoa"): tick the sessions, or take a quick range, and save. Unticking an earlier mark puts
// the player back. Used in Suunnittele → Poissaolot and from the player's page. No reason is
// asked or stored (health-data rule), the same as the player's own "En pääse".
import { useEffect, useMemo, useState } from 'react';
import { api } from '../api/index.js';
import { useData } from '../app/data.jsx';
import { useIsDesktop } from '../app/hooks.js';
import { Avatar, Button, Icon, Input, Sheet } from '../ui/index.js';
import { koutsiFmtShortDate, koutsiIsoWeekRangeLabel } from '../domain/core.js';
import { groupsOf } from '../domain/week.js';
import { ABSENCE_RANGES, absenceCandidates, absenceChanges, absenceRangeIds, byWeek, knownAbsences } from '../domain/planning.js';
import { Link } from '../app/router.js';
import { playerPath } from './nav.js';
import { track } from './usage.js';

const cx = (...c) => c.filter(Boolean).join(' ');
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const DAYS_AHEAD = 42;

/** State and save for one player's coming absences. */
function useAbsencePlan(student, source) {
  const { state, run } = useData();
  const candidates = useMemo(() => (student ? absenceCandidates(state, student.id, { days: DAYS_AHEAD }) : []), [state, student]);
  const marked = candidates.filter((c) => c.absent).map((c) => c.training.id).join(',');
  const [picked, setPicked] = useState(() => new Set(marked ? marked.split(',') : []));
  const [busy, setBusy] = useState(false);
  // a new player, or marks that changed underneath (saved here or by the player), start over
  useEffect(() => { setPicked(new Set(marked ? marked.split(',') : [])); }, [student?.id, marked]);
  const changes = absenceChanges(candidates, [...picked]);
  const toggle = (id) => setPicked((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const addRange = (range) => setPicked((prev) => new Set([...prev, ...absenceRangeIds(candidates, range)]));
  const clear = () => setPicked(new Set());
  const save = async () => {
    if (busy || !student || (!changes.away.length && !changes.back.length)) return false;
    setBusy(true);
    const msg = changes.away.length && !changes.back.length
      ? `${student.name}: poissa ${plural(changes.away.length, 'treenistä', 'treenistä')}.`
      : !changes.away.length ? `${student.name}: paikalla ${plural(changes.back.length, 'treenissä', 'treenissä')}.`
        : `${student.name}: poissaolot päivitetty.`;
    const res = await run(async () => {
      if (changes.away.length) await api.attendance.set(changes.away, student.id, 'poissa');
      if (changes.back.length) await api.attendance.set(changes.back, student.id, 'paikalla');
    }, msg);
    setBusy(false);
    if (res.ok) track(`${source}.poissaolo-tallennettu`);
    return res.ok;
  };
  return { candidates, picked, toggle, addRange, clear, changes, save, busy };
}

function saveLabel({ away, back }) {
  if (!away.length && !back.length) return 'Ei muutoksia';
  if (away.length && !back.length) return `Merkitse poissa ${plural(away.length, 'treenistä', 'treenistä')}`;
  if (!away.length) return `Merkitse paikalla ${plural(back.length, 'treenissä', 'treenissä')}`;
  return `Tallenna ${plural(away.length + back.length, 'muutos', 'muutosta')}`;
}

function AbsenceList({ plan }) {
  const { candidates, picked, toggle, addRange, clear } = plan;
  if (candidates.length === 0) return <p className="k-quiet">Ei tulevia treenejä seuraavan kuuden viikon aikana.</p>;
  return (
    <div className="ap stack-4">
      <div className="row wrap ap-ranges">
        {ABSENCE_RANGES.map((r) => <button key={r.id} type="button" className="planner-chip" onClick={() => addRange(r.id)}>{r.label}</button>)}
        {picked.size > 0 && <button type="button" className="k-textlink" onClick={clear}>Tyhjennä</button>}
      </div>
      {byWeek(candidates).map((bucket) => (
        <section key={bucket.key} className="ap-week">
          <div className="ap-week-label">Viikko {bucket.week.week} <span className="k-faint t-num">· {koutsiIsoWeekRangeLabel(bucket.week.year, bucket.week.week)}</span></div>
          <div className="ap-list">
            {bucket.items.map((c) => {
              const on = picked.has(c.training.id);
              return (
                <label key={c.training.id} className={cx('ap-row', on && 'is-away')}>
                  <input type="checkbox" checked={on} onChange={() => toggle(c.training.id)} />
                  <span className="ap-box" aria-hidden="true">{on && <Icon name="check" size={13} strokeWidth={3} />}</span>
                  <span className="ap-when t-num">{koutsiFmtShortDate(c.training.date)} {c.training.time}</span>
                  <span className="ap-what truncate">{c.group ? c.group.name : c.training.type}</span>
                  {c.byPlayer && c.absent && <span className="ap-self">Ilmoitti itse</span>}
                  <span className={cx('ap-state', on && 'is-away')}>{on ? 'Poissa' : 'Paikalla'}</span>
                </label>
              );
            })}
          </div>
        </section>
      ))}
      <p className="field-msg">Pelaaja näkee poissaolon omassa kalenterissaan. Syytä ei kysytä eikä tallenneta.</p>
    </div>
  );
}

/** From the player's page: the same planner in a sheet. */
export function AbsenceSheet({ open, onClose, student }) {
  const plan = useAbsencePlan(open ? student : null, 'pelaaja');
  const nothing = !plan.changes.away.length && !plan.changes.back.length;
  return (
    <Sheet open={open} onClose={() => !plan.busy && onClose()} size="md" title="Poissaolot" subtitle={`${student?.name || ''} · tulevat treenit`}
      footer={(
        <div className="sheet-actions">
          <Button variant="soft" size="lg" onClick={onClose} disabled={plan.busy}>Peruuta</Button>
          <Button variant="dark" size="lg" loading={plan.busy} disabled={nothing} onClick={async () => { if (await plan.save()) onClose(); }}>{saveLabel(plan.changes)}</Button>
        </div>
      )}>
      <AbsenceList plan={plan} />
    </Sheet>
  );
}

function PlayerPlanner({ student, onBack, compact = false }) {
  const { state } = useData();
  const plan = useAbsencePlan(student, 'suunnittele');
  const groups = groupsOf(state, student.id);
  const nothing = !plan.changes.away.length && !plan.changes.back.length;
  return (
    <div className="ap-card">
      {compact && <button type="button" className="ap-back" onClick={onBack}><Icon name="chevron-left" size={16} />Kaikki pelaajat</button>}
      <div className="ap-head">
        <Avatar person={student} size={44} />
        <div className="grow">
          <div className="ap-name">{student.name}</div>
          <div className="k-faint truncate">{groups.map((g) => `${g.day} ${g.time} ${g.name}`).join(' · ') || 'Ei ryhmää'}</div>
        </div>
        <Link to={playerPath(student.id)} className="k-textlink">Pelaajan sivu</Link>
      </div>
      <AbsenceList plan={plan} />
      <div className="ap-actions">
        {!compact && <Button variant="soft" size="md" onClick={onBack}>Kaikki poissaolot</Button>}
        <Button variant="dark" size="md" loading={plan.busy} disabled={nothing} onClick={plan.save}>{saveLabel(plan.changes)}</Button>
      </div>
    </div>
  );
}

function KnownAbsences({ onPick }) {
  const isDesktop = useIsDesktop(); // the player list is on the left on a computer, above on a phone
  const { state } = useData();
  const list = useMemo(() => knownAbsences(state, { days: 28 }), [state]);
  return (
    <div className="ap-card">
      <div className="ap-card-title">Tiedossa olevat poissaolot</div>
      <p className="k-faint ap-card-sub">Seuraavat neljä viikkoa. Valitse pelaaja {isDesktop ? 'vasemmalta' : 'yltä'}, niin merkitset hänet poissa monesta treenistä kerralla.</p>
      {list.length === 0 ? <p className="k-quiet">Ei tiedossa olevia poissaoloja.</p> : (
        <div className="ap-known">
          {list.map((x) => (
            <div key={x.training.id} className="ap-known-row">
              <span className="ap-when t-num">{koutsiFmtShortDate(x.training.date)} {x.training.time}</span>
              <span className="ap-what truncate">{x.group ? x.group.name : x.training.type}</span>
              <span className="ap-known-who">
                {x.students.map((s) => <button key={s.id} type="button" className="chip chip-sm chip-outline" onClick={() => onPick(s.id)}>{s.name}</button>)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Suunnittele → Poissaolot: pick a player on the left, plan their absences on the right. */
export function AbsencePlannerPanel({ compact = false }) {
  const { state } = useData();
  const isDesktop = useIsDesktop() && !compact;
  const [query, setQuery] = useState('');
  const [chosen, setChosen] = useState(null);
  const players = useMemo(() => [...state.students].sort((a, b) => a.name.localeCompare(b.name, 'fi')), [state.students]);
  const q = query.trim().toLocaleLowerCase('fi');
  const shown = q ? players.filter((s) => s.name.toLocaleLowerCase('fi').includes(q)) : players;
  const student = chosen ? state.students.find((s) => s.id === chosen) || null : null;
  const awayCount = useMemo(() => new Map(players.map((s) => [s.id, absenceCandidates(state, s.id, { days: DAYS_AHEAD }).filter((c) => c.absent).length])), [state, players]);
  const pick = (id) => {
    setChosen(id);
    track('suunnittele.poissaolo-pelaaja');
    if (!isDesktop) {
      window.scrollTo({ top: 0 });
      // inside a sheet the sheet's own body is what scrolled
      requestAnimationFrame(() => document.querySelectorAll('.sheet-body').forEach((el) => { el.scrollTop = 0; }));
    }
  };
  // a phone shows one thing at a time: the list, or the chosen player's sessions
  if (!isDesktop && student) {
    return <div className={compact ? 'ap-panel ap-in-sheet' : 'ap-panel'}><PlayerPlanner key={student.id} student={student} compact onBack={() => setChosen(null)} /></div>;
  }
  return (
    <div className={compact ? 'ap-panel ap-in-sheet' : 'ap-panel'}>
      <aside className="ap-players">
        <Input icon="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Hae pelaajaa" aria-label="Hae pelaajaa" />
        <div className="ap-player-list">
          {shown.map((s) => {
            const away = awayCount.get(s.id) || 0;
            return (
              <button key={s.id} type="button" className={cx('ap-player', chosen === s.id && 'is-on')} onClick={() => pick(s.id)}>
                <Avatar person={s} size={30} />
                <span className="grow truncate">{s.name}</span>
                {away > 0 && <span className="ap-player-away">{away} poissa</span>}
              </button>
            );
          })}
          {shown.length === 0 && <p className="k-quiet">Ei pelaajaa nimellä ”{query}”.</p>}
        </div>
      </aside>
      {!compact && (
        <div className="ap-main">
          {student ? <PlayerPlanner key={student.id} student={student} onBack={() => setChosen(null)} /> : <KnownAbsences onPick={pick} />}
        </div>
      )}
    </div>
  );
}

/** Merkitse → Poissaolo: pick the player, then tick their coming sessions. */
export function AbsencePickerSheet({ open, onClose }) {
  return (
    <Sheet open={open} onClose={onClose} size="md" title="Poissaolo" subtitle="Valitse pelaaja, sitten treenit, joista hän on pois.">
      {open && <AbsencePlannerPanel compact />}
    </Sheet>
  );
}
