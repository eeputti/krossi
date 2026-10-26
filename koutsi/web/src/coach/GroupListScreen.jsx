// GroupListScreen — "Ryhmät" (a side-nav tab on a computer, under Pelaajat): every group of the
// season as a list by weekday, each with this week's theme. Viikkohallinta shows the same groups
// as a calendar; this is the place to find one group by name and open its page.
import { useMemo, useState } from 'react';
import { useData } from '../app/data.jsx';
import { Button, EmptyState, Input, Page, PageHeader } from '../ui/index.js';
import { koutsiSortGroupsBySchedule, koutsiWeekThemeStatus } from '../domain/core.js';
import { DAY_NAMES, plannerDefaultWeek } from '../domain/week.js';
import { GroupRow } from './parts.jsx';
import { GroupFormSheet } from './groupForms.jsx';
import { BulkSetupSheet } from './BulkSetupSheet.jsx';

const remembered = { query: '' }; // back from a group finds the search as it was left

export function GroupListScreen() {
  const { state } = useData();
  const [formOpen, setFormOpen] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [query, setQueryState] = useState(remembered.query);
  const setQuery = (v) => { remembered.query = v; setQueryState(v); };
  const week = plannerDefaultWeek();
  const status = koutsiWeekThemeStatus(state.groups, state.trainings, week);
  const q = query.trim().toLocaleLowerCase('fi');
  const byDay = useMemo(() => {
    const out = [];
    koutsiSortGroupsBySchedule(state.groups)
      .filter((g) => !q || `${g.name} ${g.level || ''} ${g.day} ${g.time}`.toLocaleLowerCase('fi').includes(q))
      .forEach((g) => {
        const day = DAY_NAMES[g.day] ? g.day : '';
        let bucket = out.find((b) => b.day === day);
        if (!bucket) { bucket = { day, groups: [] }; out.push(bucket); }
        bucket.groups.push(g);
      });
    return out;
  }, [state.groups, q]);
  const players = new Set(state.groups.flatMap((g) => g.memberIds)).size;
  return (
    <Page width="wide">
      <PageHeader
        title="Ryhmät"
        subtitle={state.groups.length ? `${state.groups.length} ryhmää · ${players} pelaajaa · teema ${status.covered}/${status.pool.length} ryhmällä vko ${week.week}` : 'Ei vielä ryhmiä'}
        actions={state.groups.length > 0 && (
          <>
            <Button variant="outline" size="sm" icon="list" onClick={() => setBulkOpen(true)}>Monta kerralla</Button>
            <Button variant="dark" size="sm" icon="plus" onClick={() => setFormOpen(true)}>Uusi ryhmä</Button>
          </>
        )}
      />
      {state.groups.length === 0 ? (
        <EmptyState art="players" title="Luo ensimmäinen ryhmä" text="Ryhmän viikoittaiset treenit ilmestyvät kalenteriin, ja voit asettaa niille viikon teeman."
          action={<><Button variant="dark" icon="plus" onClick={() => setFormOpen(true)}>Luo ryhmä</Button><Button variant="outline" icon="list" onClick={() => setBulkOpen(true)}>Lisää monta kerralla</Button></>} />
      ) : (
        <div className="stack-5">
          <Input icon="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Hae ryhmää" aria-label="Hae ryhmää" className="gl-search" />
          {byDay.length === 0 && <p className="k-quiet">Ei ryhmää haulla ”{query}”.</p>}
          <div className="gl-days">
            {byDay.map((bucket) => (
              <section key={bucket.day || 'muut'} className="k-day-section">
                <h2 className="k-day-title">{DAY_NAMES[bucket.day] || 'Muut'}</h2>
                <div className="k-list">
                  {bucket.groups.map((g) => <GroupRow key={g.id} group={g} week={week} linkState={{ tab: 'ryhmalista' }} />)}
                </div>
              </section>
            ))}
          </div>
        </div>
      )}
      <GroupFormSheet open={formOpen} onClose={() => setFormOpen(false)} />
      <BulkSetupSheet open={bulkOpen} onClose={() => setBulkOpen(false)} />
    </Page>
  );
}
