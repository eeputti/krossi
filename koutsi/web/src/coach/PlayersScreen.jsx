// PlayersScreen — the roster: search, a filter for who hasn't joined or has been active, and
// rows that say which groups a player is in (by day and time, not just by name).
import { useMemo, useState } from 'react';
import { useData } from '../app/data.jsx';
import { Button, Chip, EmptyState, Input, Page, PageHeader, Segmented } from '../ui/index.js';
import { duplicateNames, matchStudents } from '../domain/roster.js';
import { groupsOf, lastActivityDays } from '../domain/week.js';
import { PlayerRow } from './parts.jsx';
import { AddPlayerSheet, MergeSheet } from './playerForms.jsx';
import { BulkSetupSheet } from './BulkSetupSheet.jsx';
import { openInvites } from './nav.js';

function activityLabel(days) {
  if (days == null) return null;
  if (days === 0) return 'tänään';
  if (days === 1) return 'eilen';
  return `${days} pv sitten`;
}

export function PlayersScreen() {
  const { state } = useData();
  const [filter, setFilter] = useState('all');
  const [query, setQuery] = useState('');
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
  return (
    <Page>
      <PageHeader
        title="Pelaajat"
        subtitle={state.students.length ? `${state.students.length} pelaajaa${unjoined ? ` · ${unjoined} ei vielä liittynyt` : ''}` : 'Ei vielä pelaajia'}
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
          {visible.length === 0 ? <p className="k-quiet">Ei osumia.</p> : (
            <div className="k-list stagger">
              {visible.map((r, i) => (
                <div key={r.s.id} style={{ '--i': i }}>
                  <PlayerRow
                    student={r.s}
                    sub={r.groups.length ? r.groups.map((g) => `${g.day} ${g.time}`).join(', ') + (r.s.level ? ` · ${r.s.level}` : '') : (r.s.level || 'Ei ryhmää')}
                    right={r.s.isPlaceholder ? <Chip tone="warn" size="sm">Ei liittynyt</Chip> : r.days != null && r.days <= 14 ? <Chip tone="success" size="sm">{activityLabel(r.days)}</Chip> : null}
                  />
                </div>
              ))}
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
