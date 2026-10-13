// GroupsScreen — the coach's groups as the week runs: Monday first, then by time, each with
// this week's theme status. Same-named groups ("tiistai aikuiset" ×4) are told apart by time.
import { useMemo, useState } from 'react';
import { useData } from '../app/data.jsx';
import { Button, EmptyState, Page, PageHeader } from '../ui/index.js';
import { koutsiSortGroupsBySchedule, koutsiWeekThemeStatus } from '../domain/core.js';
import { DAY_NAMES, plannerDefaultWeek } from '../domain/week.js';
import { GroupRow } from './parts.jsx';
import { GroupFormSheet } from './groupForms.jsx';
import { BulkSetupSheet } from './BulkSetupSheet.jsx';
import { openPlanner } from './nav.js';

export function GroupsScreen() {
  const { state } = useData();
  const [formOpen, setFormOpen] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const week = plannerDefaultWeek();
  const status = koutsiWeekThemeStatus(state.groups, state.trainings, week);
  const byDay = useMemo(() => {
    const out = [];
    koutsiSortGroupsBySchedule(state.groups).forEach((g) => {
      const day = DAY_NAMES[g.day] ? g.day : '';
      let bucket = out.find((b) => b.day === day);
      if (!bucket) { bucket = { day, groups: [] }; out.push(bucket); }
      bucket.groups.push(g);
    });
    return out;
  }, [state.groups]);
  return (
    <Page>
      <PageHeader
        title="Ryhmät"
        subtitle={state.groups.length ? `${state.groups.length} ryhmää · teema ${status.covered}/${status.pool.length} ryhmällä vko ${week.week}` : 'Ei vielä ryhmiä'}
        actions={state.groups.length > 0 && <Button variant="dark" size="sm" icon="plus" onClick={() => setFormOpen(true)}>Uusi</Button>}
      />
      {state.groups.length === 0 ? (
        <EmptyState art="players" title="Luo ensimmäinen ryhmä" text="Ryhmän viikoittaiset treenit ilmestyvät kalenteriin, ja voit asettaa niille viikon teeman."
          action={<><Button variant="dark" icon="plus" onClick={() => setFormOpen(true)}>Luo ryhmä</Button><Button variant="outline" icon="list" onClick={() => setBulkOpen(true)}>Lisää monta kerralla</Button></>} />
      ) : (
        <div className="stack-5">
          <div className="k-banner-card">
            <div className="grow">
              <div className="k-banner-title">Viikon teemat</div>
              <div className="k-banner-sub">{status.covered}/{status.pool.length} ryhmällä on teema viikolla {week.week}.</div>
            </div>
            <Button variant="lime" size="sm" icon="sparkles" onClick={() => openPlanner({ week })}>Avaa</Button>
          </div>
          {byDay.map((bucket) => (
            <section key={bucket.day || 'muut'} className="k-day-section">
              <h2 className="k-day-title">{DAY_NAMES[bucket.day] || 'Muut'}</h2>
              <div className="k-list stagger">
                {bucket.groups.map((g, i) => <div key={g.id} style={{ '--i': i }}><GroupRow group={g} week={week} /></div>)}
              </div>
            </section>
          ))}
          <Button variant="ghost" icon="list" onClick={() => setBulkOpen(true)}>Lisää monta ryhmää ja pelaajaa kerralla</Button>
        </div>
      )}
      <GroupFormSheet open={formOpen} onClose={() => setFormOpen(false)} />
      <BulkSetupSheet open={bulkOpen} onClose={() => setBulkOpen(false)} />
    </Page>
  );
}
