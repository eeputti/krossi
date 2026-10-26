// SentScreen — Lähetetyt (/valmentaja/lahetetyt): everything the coach has sent to players, like
// a mail app's sent folder — videos, homework, notes and tiedotteet, newest day first. One row says
// what, to whom and when (a homework also how many have done it); a tap opens it (SentSheet): who
// got it, Muokkaa, Poista, "Lähetä myös muille". ?laji= picks a kind, ?ryhma= one group's sendings
// (a group page's "Näytä kaikki"). Hidden until the database has Lähetetyt (state.sendsReady).
import { useMemo, useState } from 'react';
import { useData } from '../app/data.jsx';
import { dropQueryParam, navigate, useRoute } from '../app/router.js';
import { Button, ChipSelect, EmptyState, Icon, Page, PageHeader } from '../ui/index.js';
import { filterSent, groupName, SENT_FILTERS, sentByDay, sentItems } from '../domain/sends.js';
import { SentRow, SentSheet } from './sent.jsx';
import { useRecord } from './merkitse.jsx';
import { track } from './usage.js';

const remembered = { kind: 'kaikki' }; // back from a player's page finds the filter as it was left

export function SentScreen() {
  const { state } = useData();
  const route = useRoute();
  const record = useRecord();
  const [kind, setKindState] = useState(() => (SENT_FILTERS.some((f) => f.value === route.query.laji) ? route.query.laji : remembered.kind));
  const setKind = (v) => { remembered.kind = v; track(`lahetetyt.suodata-${v}`); setKindState(v); };
  const groupId = route.query.ryhma || null;
  const group = groupId ? (state.allGroups || state.groups).find((g) => g.id === groupId) : null;
  const [openKey, setOpenKey] = useState(null);
  const all = useMemo(() => sentItems(state), [state]);
  const shown = useMemo(() => filterSent(all, { kind, groupId: group ? groupId : null }), [all, kind, groupId, group]);
  const days = useMemo(() => sentByDay(shown), [shown]);

  if (!state.sendsReady) {
    return (
      <Page>
        <PageHeader title="Lähetetyt" />
        <EmptyState art="court" title="Tulossa pian" text="Täällä näet pian kaiken, mitä olet lähettänyt pelaajille: videot, kotiläksyt, huomiot ja tiedotteet." />
      </Page>
    );
  }

  const count = all.length;
  return (
    <Page className="stack-5">
      <PageHeader
        title="Lähetetyt"
        subtitle={count ? 'Kaikki, mitä olet lähettänyt pelaajille. Avaa ja lähetä myös muille.' : null}
      />
      {count > 0 && (
        <div className="stack-3">
          <ChipSelect size="sm" layout="scroll" options={SENT_FILTERS} value={kind} onChange={setKind} ariaLabel="Näytä" className="sent-filters" />
          {group && (
            <div className="sent-group-filter">
              <span className="sent-group-pill"><Icon name="users" size={14} />{groupName(state.allGroups || state.groups, group)}</span>
              <button type="button" className="k-textlink" onClick={() => { dropQueryParam('ryhma'); navigate('/valmentaja/lahetetyt', { replace: true }); }}>Näytä kaikki ryhmät</button>
            </div>
          )}
        </div>
      )}
      {count === 0 ? (
        <EmptyState art="court" title="Et ole vielä lähettänyt mitään"
          text="Kun jaat videon, annat kotiläksyn tai lähetät huomion tai tiedotteen, se näkyy täällä: kenelle ja milloin. Täältä voit lähettää saman myös muille."
          action={<Button variant="dark" icon="plus" onClick={() => record.openMerkinta()}>Merkitse</Button>} />
      ) : days.length === 0 ? (
        <p className="k-quiet">Ei lähetyksiä tällä valinnalla.</p>
      ) : (
        <div className="stack-5">
          {days.map((d) => (
            <section key={d.day} className="k-day-section">
              <h2 className="k-day-title">{d.label}</h2>
              <div className="k-list">
                {d.items.map((it) => <SentRow key={it.key} item={it} onOpen={(x) => { track(`lahetetyt.avaa-${x.kind}`); setOpenKey(x.key); }} />)}
              </div>
            </section>
          ))}
        </div>
      )}
      <SentSheet itemKey={openKey} onClose={() => setOpenKey(null)} />
    </Page>
  );
}
