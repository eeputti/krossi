// GroupPlannerSheet — the hallisarja admin makes the next round's groups and starts it.
// Starts from proposeGroups(): round 1 by level, later rounds with the winner (and runner-up
// in groups of 6+) up and the last (and second-to-last) down, newcomers at the bottom and
// players who won't continue resting. Every player has a "Lohko" picker to move them.
//   <GroupPlannerSheet open onClose league onStarted={(roundNumber) => …} />
import { useEffect, useMemo, useState } from 'react';
import { api } from '../../api/index.js';
import { useBusy } from '../../app/hooks.js';
import { plural } from '../../lib/format.js';
import { Avatar, Button, Chip, Field, Icon, Input, Sheet, Stepper, useConfirm, useToast } from '../../ui/index.js';
import {
  MIN_ROUND_PLAYERS, currentGroupIndex, groupLetter, levelLabel, moveOf, nextMonday, proposeGroups, roundAfter,
  roundFrom, roundOf, roundRange, shortName,
} from './leagueUtils.js';

const cx = (...c) => c.filter(Boolean).join(' ');
const REST = 'rest';
const NEW_GROUP = 'new';
const MOVE_CHIP = {
  up: { tone: 'success', icon: 'chevron-up', label: 'Nousi' },
  down: { tone: 'warn', icon: 'chevron-down', label: 'Putosi' },
  new: { tone: 'lime', icon: 'sparkles', label: 'Uusi' },
};

function defaultDates(league) {
  const n = (league.currentRound || 0) + 1;
  const planned = roundOf(league, n);
  if (planned) return { startsOn: planned.startsOn, endsOn: planned.endsOn };
  const prev = roundOf(league, league.currentRound);
  return prev ? roundAfter(prev) : roundFrom(nextMonday());
}

export function GroupPlannerSheet({ open, onClose, league, onStarted }) {
  const toast = useToast();
  const confirm = useConfirm();
  const [busy, run] = useBusy();
  const [size, setSize] = useState(league.groupSize || 5);
  const [groups, setGroups] = useState([]);
  const [dates, setDates] = useState(() => defaultDates(league));
  const n = (league.currentRound || 0) + 1;
  const people = useMemo(() => new Map(league.members.map((m) => [m.id, m])), [league.members]);
  const previous = useMemo(() => currentGroupIndex(league), [league]);
  const firstRound = n === 1;

  const propose = (s) => setGroups(proposeGroups(league, { size: s }));

  useEffect(() => {
    if (!open) return;
    const s = league.groupSize || 5;
    setSize(s);
    propose(s);
    setDates(defaultDates(league));
  }, [open, league.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const placed = new Set(groups.flat());
  const resting = league.members.filter((m) => !placed.has(m.id));
  const matches = groups.reduce((sum, g) => sum + (g.length * (g.length - 1)) / 2, 0);
  const tooSmall = groups.some((g) => g.length < MIN_ROUND_PLAYERS);
  const datesOk = dates.startsOn && dates.endsOn && dates.endsOn >= dates.startsOn;
  const canStart = groups.length > 0 && !tooSmall && datesOk;

  /** Move a player to group index `to` (number), a new bottom group, or the resting list. */
  const move = (id, to) => setGroups((list) => {
    let next = list.map((g) => g.filter((x) => x !== id));
    if (to === NEW_GROUP) next = [...next, [id]];
    else if (to !== REST) next = next.map((g, i) => (i === Number(to) ? [...g, id] : g));
    return next.filter((g) => g.length > 0);
  });

  const start = () => run(async () => {
    const ok = await confirm({
      title: `Aloitetaanko kierros ${n}?`,
      message: `${plural(groups.length, 'lohko', 'lohkoa')}, ${plural(groups.flat().length, 'pelaaja', 'pelaajaa')} ja ${plural(matches, 'ottelu', 'ottelua')} (${roundRange(dates)}). Pelaajat näkevät lohkonsa ja vastustajansa heti.`,
      confirmLabel: `Aloita kierros ${n}`,
    });
    if (!ok) return;
    try {
      const round = await api.leagues.startRound(league.id, groups, dates);
      onStarted?.(round);
    } catch (err) {
      toast(err);
    }
  });

  const options = (current) => [
    ...groups.map((_, i) => ({ value: String(i), label: `Lohko ${groupLetter(i + 1)}` })),
    ...(current === NEW_GROUP ? [] : [{ value: NEW_GROUP, label: 'Uusi lohko' }]),
    { value: REST, label: 'Tauolla' },
  ];

  const row = (id, at) => {
    const m = people.get(id) || { id, name: 'Pelaaja' };
    const mv = firstRound ? null : MOVE_CHIP[at === REST ? null : moveOf(previous, id, at)];
    return (
      <li key={id} className="leagues-plan-player">
        <Avatar person={m} size={32} />
        <span className="leagues-plan-player-text">
          <span className="leagues-plan-player-name truncate">{shortName(m.name)}</span>
          <span className="leagues-plan-player-sub">
            {m.skillLevel ? levelLabel(m.skillLevel) : 'Taso ei tiedossa'}
            {m.continues === false ? ' · ei jatka' : ''}
          </span>
        </span>
        {mv && <Chip tone={mv.tone} size="sm" icon={mv.icon}>{mv.label}</Chip>}
        <span className="select-wrap leagues-plan-select">
          <select
            className="input select"
            aria-label={`Lohko: ${m.name}`}
            value={at === REST ? REST : String(at)}
            onChange={(e) => move(id, e.target.value === REST || e.target.value === NEW_GROUP ? e.target.value : Number(e.target.value))}
          >
            {options(at).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <Icon name="chevron-down" size={16} className="select-chevron" />
        </span>
      </li>
    );
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      size="lg"
      title={`Kierros ${n}: lohkot`}
      subtitle={firstRound
        ? 'Ehdotus on tehty tason mukaan, vahvimmat ylimpään lohkoon. Siirrä pelaajia tarpeen mukaan.'
        : `Ehdotus kierroksen ${league.currentRound} tuloksista: lohkon voittaja nousee ja viimeinen putoaa (kuuden lohkossa kaksi). Uudet pelaajat alkavat alimmasta.`}
      footer={(
        <div className="leagues-plan-footer">
          <p className={cx('leagues-plan-summary', tooSmall && 'is-error')} aria-live="polite">
            {tooSmall
              ? `Jokaisessa lohkossa pitää olla vähintään ${MIN_ROUND_PLAYERS} pelaajaa.`
              : `${plural(groups.length, 'lohko', 'lohkoa')} · ${plural(groups.flat().length, 'pelaaja', 'pelaajaa')} · ${plural(matches, 'ottelu', 'ottelua')}`}
          </p>
          <Button variant="lime" size="lg" block icon="play" loading={busy} disabled={!canStart} onClick={start}>Aloita kierros {n}</Button>
        </div>
      )}
    >
      <div className="leagues-plan">
        <div className="leagues-plan-dates">
          <Field label="Alkaa" htmlFor="plan-start">
            <Input id="plan-start" type="date" value={dates.startsOn} onChange={(e) => setDates((d) => ({ ...d, startsOn: e.target.value }))} />
          </Field>
          <Field label="Päättyy" htmlFor="plan-end" error={dates.startsOn && dates.endsOn && !datesOk ? 'Loppu ennen alkua' : undefined}>
            <Input id="plan-end" type="date" value={dates.endsOn} min={dates.startsOn} onChange={(e) => setDates((d) => ({ ...d, endsOn: e.target.value }))} />
          </Field>
        </div>

        <div className="leagues-plan-size">
          <span className="leagues-plan-size-label">Lohkon koko</span>
          <Stepper value={size} onChange={setSize} min={3} max={8} label="Lohkon koko" size="sm" />
          <Button variant="soft" size="sm" icon="refresh" onClick={() => propose(size)}>Jaa uudelleen</Button>
        </div>

        {groups.length === 0 && (
          <p className="leagues-adm-help">Sarjassa ei ole vielä tarpeeksi pelaajia. Lohkoon tarvitaan vähintään {MIN_ROUND_PLAYERS}.</p>
        )}

        {groups.map((ids, i) => (
          <section key={i} className={cx('leagues-plan-group', ids.length < MIN_ROUND_PLAYERS && 'is-error')}>
            <div className="leagues-plan-group-head">
              <span className="leagues-plan-letter" aria-hidden="true">{groupLetter(i + 1)}</span>
              <h3 className="leagues-plan-group-title">Lohko {groupLetter(i + 1)}</h3>
              <span className="leagues-plan-group-meta t-num">{plural(ids.length, 'pelaaja', 'pelaajaa')} · {plural((ids.length * (ids.length - 1)) / 2, 'ottelu', 'ottelua')}</span>
            </div>
            <ul className="leagues-plan-list">{ids.map((id) => row(id, i))}</ul>
          </section>
        ))}

        {resting.length > 0 && (
          <section className="leagues-plan-group is-rest">
            <div className="leagues-plan-group-head">
              <span className="leagues-plan-letter is-rest" aria-hidden="true"><Icon name="moon" size={15} /></span>
              <h3 className="leagues-plan-group-title">Tauolla tällä kierroksella</h3>
              <span className="leagues-plan-group-meta t-num">{resting.length}</span>
            </div>
            <ul className="leagues-plan-list">{resting.map((m) => row(m.id, REST))}</ul>
          </section>
        )}
      </div>
    </Sheet>
  );
}
