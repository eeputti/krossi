// PlayersScreen — the roster: search, a filter for who hasn't joined or has been active, and the
// players under the session nearest to now (going on, just over, next…), each with their next
// session; everyone else after them by name. A search lists matches by name instead.
import { useMemo, useState } from 'react';
import { useData } from '../app/data.jsx';
import { Link } from '../app/router.js';
import { Button, Chip, EmptyState, Icon, Input, Page, PageHeader, Segmented } from '../ui/index.js';
import { koutsiTodayStr } from '../domain/core.js';
import { duplicateNames, matchStudents } from '../domain/roster.js';
import {
  JUST_ENDED_MINUTES, groupsOf, lastActivityDays, minutesLabel, playerSections, relativeDay, sessionRoster, sessionWhen,
} from '../domain/week.js';
import { PlayerRow } from './parts.jsx';
import { AddPlayerSheet, MergeSheet } from './playerForms.jsx';
import { BulkSetupSheet } from './BulkSetupSheet.jsx';
import { openInvites, sessionPath } from './nav.js';

function activityLabel(days) {
  if (days == null) return null;
  if (days === 0) return 'tänään';
  if (days === 1) return 'eilen';
  return `${days} pv sitten`;
}

const cx = (...c) => c.filter(Boolean).join(' ');

/** "Nyt käynnissä", "Juuri päättynyt", "Aiemmin tänään", "Eilen", "Tänään · alkaa 45 min päästä", "Huomenna", "To 22.10." */
function sectionWhen(sec, today) {
  if (sec.status === 'now') return 'Nyt käynnissä';
  if (sec.status === 'past') return sec.minutesAgo <= JUST_ENDED_MINUTES ? 'Juuri päättynyt' : sec.training.date === today ? 'Aiemmin tänään' : 'Eilen';
  const day = relativeDay(sec.training.date, today);
  const soon = sec.minutesUntil <= 180 ? `, alkaa ${minutesLabel(sec.minutesUntil)} päästä` : '';
  return day.charAt(0).toUpperCase() + day.slice(1) + soon;
}

/** One session's heading on Pelaajat: when, what, and who was there or is away. A tap opens the session. */
function SessionHead({ sec, state, when }) {
  const roster = sessionRoster(state, sec.training).length;
  const away = (sec.training.absences || []).length;
  const name = sec.group ? sec.group.name : [sec.training.type, sec.student?.name].filter(Boolean).join(', ');
  const meta = sec.status === 'past' ? `läsnä ${Math.max(0, roster - away)}/${roster}` : away ? `${away} poissa` : '';
  const just = sec.status === 'now' || (sec.status === 'past' && sec.minutesAgo <= JUST_ENDED_MINUTES);
  return (
    <Link to={sessionPath(sec.training.id)} className={cx('k-psec-head', just && 'is-live')}>
      <span className="k-psec-text">
        {when && <span className="k-psec-when">{sec.status === 'now' && <span className="k-ctx-live" aria-hidden="true" />}{when}</span>}
        <span className="k-psec-title truncate"><span className="t-num">{sec.training.time}–{sec.end}</span> {name}</span>
      </span>
      {meta && <span className="k-psec-meta t-num">{meta}</span>}
      <Icon name="chevron-right" size={16} className="k-chevron" />
    </Link>
  );
}

function rowChip(student, days, absent) {
  if (absent) return <Chip size="sm">Poissa</Chip>;
  if (student.isPlaceholder) return <Chip tone="warn" size="sm">Ei liittynyt</Chip>;
  return days != null && days <= 14 ? <Chip tone="success" size="sm">{activityLabel(days)}</Chip> : null;
}

// kept while the app is open: back from a player's page finds the list as it was left
const remembered = { filter: 'all', query: '' };

export function PlayersScreen() {
  const { state } = useData();
  const [filter, setFilterState] = useState(remembered.filter);
  const [query, setQueryState] = useState(remembered.query);
  const setFilter = (v) => { remembered.filter = v; setFilterState(v); };
  const setQuery = (v) => { remembered.query = v; setQueryState(v); };
  const [addOpen, setAddOpen] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [mergeFor, setMergeFor] = useState(null);
  const rows = useMemo(() => state.students.map((s) => ({ s, days: lastActivityDays(state, s), groups: groupsOf(state, s.id) })), [state]);
  const unjoined = rows.filter((r) => r.s.isPlaceholder).length;
  const active = rows.filter((r) => r.days != null && r.days <= 14).length;
  const dupes = useMemo(() => duplicateNames(state.students), [state.students]);
  const visible = useMemo(() => {
    const base = query.trim() ? matchStudents(state.students, query, { limit: 500 }).map((s) => rows.find((r) => r.s.id === s.id)) : rows;
    const list = base.filter((r) => filter === 'all' || (filter === 'unjoined' ? r.s.isPlaceholder : r.days != null && r.days <= 14));
    return list.sort((a, b) => a.s.name.localeCompare(b.s.name, 'fi'));
  }, [rows, filter, query, state.students]);
  // Without a search: the players under the session nearest to now, the filter applied within.
  const today = koutsiTodayStr();
  const nearest = useMemo(() => playerSections(state), [state]);
  const visibleIds = new Set(visible.map((r) => r.s.id));
  const shown = (student) => visibleIds.has(student.id);
  const sections = nearest.sections
    .map((sec) => ({ ...sec, players: sec.players.filter((p) => shown(p.student)) }))
    .filter((sec) => sec.players.length);
  const rest = nearest.rest.filter((p) => shown(p.student));
  const daysOf = (id) => rows.find((r) => r.s.id === id)?.days ?? null;
  const groupTimes = (id) => {
    const r = rows.find((x) => x.s.id === id);
    return r?.groups.length ? r.groups.map((g) => `${g.day} ${g.time}`).join(', ') : 'Ei ryhmää';
  };
  return (
    <Page>
      <PageHeader
        title="Pelaajat"
        subtitle={state.students.length ? `${state.students.length} pelaajaa${unjoined ? `, ${unjoined} ei vielä liittynyt` : ''}` : 'Ei vielä pelaajia'}
        actions={state.students.length > 0 && (
          <>
            <Button variant="outline" size="sm" icon="send" onClick={openInvites}>Kutsu</Button>
            <Button variant="dark" size="sm" icon="plus" onClick={() => setAddOpen(true)}>Lisää</Button>
          </>
        )}
      />
      {state.students.length === 0 ? (
        <EmptyState art="players" title="Lisää ensimmäiset pelaajat" text="Nimi riittää. Pelaajat liittyvät myöhemmin omilla linkeillään, ja kaikki kirjattu siirtyy heille."
          action={<><Button variant="dark" icon="plus" onClick={() => setAddOpen(true)}>Lisää pelaaja</Button><Button variant="outline" icon="list" onClick={() => setBulkOpen(true)}>Lisää monta kerralla</Button></>} />
      ) : (
        <div className="stack-4">
          {dupes.length > 0 && (
            <div className="k-banner-card is-warn">
              <div className="grow">
                <div className="k-banner-title">Sama nimi kahdesti</div>
                <div className="k-banner-sub">{dupes.map((d) => d[0].name).join(', ')} — sama pelaaja voi olla listalla kahdesti. Yhdistä profiilit, niin kumpikaan ryhmä ei katoa.</div>
              </div>
              <Button variant="dark" size="sm" onClick={() => setMergeFor(dupes[0][0])}>Yhdistä</Button>
            </div>
          )}
          {state.students.length > 5 && <Input icon="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Hae nimellä" aria-label="Hae pelaajaa" />}
          <Segmented ariaLabel="Suodata pelaajat" value={filter} onChange={setFilter} options={[
            { value: 'all', label: 'Kaikki', badge: state.students.length },
            { value: 'unjoined', label: 'Ei liittynyt', badge: unjoined || undefined },
            { value: 'active', label: 'Aktiiviset', badge: active || undefined },
          ]} />
          {query.trim() ? (
            visible.length === 0 ? <p className="k-quiet">Ei osumia.</p> : (
              <div className="k-list stagger">
                {visible.map((r, i) => (
                  <div key={r.s.id} style={{ '--i': i }}>
                    <PlayerRow
                      student={r.s}
                      sub={r.groups.length ? r.groups.map((g) => `${g.day} ${g.time}`).join(', ') + (r.s.level ? `, ${r.s.level}` : '') : (r.s.level || 'Ei ryhmää')}
                      right={rowChip(r.s, r.days, false)}
                    />
                  </div>
                ))}
              </div>
            )
          ) : sections.length + rest.length === 0 ? <p className="k-quiet">Ei osumia.</p> : (
            <div className="k-psecs">
              {sections.map((sec, i) => (
                <section key={sec.training.id} className={cx('k-psec', `is-${sec.status}`)}>
                  {/* the same day twice in a row is said once */}
                  <SessionHead sec={sec} state={state}
                    when={i > 0 && sectionWhen(sections[i - 1], today) === sectionWhen(sec, today) ? null : sectionWhen(sec, today)} />
                  <div className="k-list">
                    {sec.players.map(({ student, absent, next }) => (
                      <PlayerRow
                        key={student.id}
                        student={student}
                        sub={next ? `${sec.status === 'upcoming' ? 'Sitten' : 'Seuraava'} ${sessionWhen(next, today)}` : sec.status === 'upcoming' ? (student.level || '') : 'Ei tulevia treenejä'}
                        right={rowChip(student, daysOf(student.id), absent)}
                      />
                    ))}
                  </div>
                </section>
              ))}
              {rest.length > 0 && (
                <section className="k-psec is-rest">
                  <div className="k-psec-head is-static">
                    <span className="k-psec-text">
                      <span className="k-psec-when">{sections.length ? 'Muut pelaajat' : 'Ei treenejä viikon sisällä'}</span>
                    </span>
                  </div>
                  <div className="k-list">
                    {rest.map(({ student, next }) => (
                      <PlayerRow
                        key={student.id}
                        student={student}
                        sub={next ? `Seuraava ${sessionWhen(next, today)}` : groupTimes(student.id) + (student.level ? `, ${student.level}` : '')}
                        right={rowChip(student, daysOf(student.id), false)}
                      />
                    ))}
                  </div>
                </section>
              )}
            </div>
          )}
          {unjoined > 0 && filter === 'unjoined' && <Button variant="lime" icon="send" block onClick={openInvites}>Lähetä kutsut ({unjoined})</Button>}
        </div>
      )}
      <AddPlayerSheet open={addOpen} onClose={() => setAddOpen(false)} />
      <BulkSetupSheet open={bulkOpen} onClose={() => setBulkOpen(false)} />
      <MergeSheet open={Boolean(mergeFor)} student={mergeFor} onClose={() => setMergeFor(null)} />
    </Page>
  );
}
