// HallSeasons — Hallin näkymä → Kausivuorot: the requests waiting for the hall (oldest first,
// with "Käsittele"), the season slots in force by weekday, and the ended / declined ones. "Uusi
// kausivuoro" adds one for a club or a company. Every row opens SeasonStaffSheet. Seasons
// themselves are set up in Hallin asetukset.
import { useState } from 'react';
import { api } from '../../api/index.js';
import { useAsync } from '../../app/hooks.js';
import { navigate } from '../../app/router.js';
import { centsLabel } from '../../features/booking.js';
import { WEEKDAY_NAMES, dayMonth, slotWhen } from '../../features/seasons.js';
import { formatGameTime } from '../../lib/format.js';
import { Avatar, Button, Disclosure, ErrorState, Icon, Skeleton, useToast } from '../../ui/index.js';
import { InvoiceStateChip, SlotStatusChip } from './SeasonParts.jsx';
import { SeasonStaffSheet } from './SeasonStaffSheet.jsx';

const cx = (...c) => c.filter(Boolean).join(' ');

function billingText(slot) {
  if (slot.billing === 'invoice') return slot.invoice ? null : 'Lasku';
  const failed = slot.charges.filter((c) => c.status === 'failed').length;
  if (failed) return `Kortti · ${failed} epäonnistui`;
  const paid = slot.charges.filter((c) => c.status === 'paid').length;
  return slot.charges.length ? `Kortti · ${paid}/${slot.charges.filter((c) => c.status !== 'void').length} kk` : 'Kortti';
}

export function HallSeasons({ venue, onChanged }) {
  const toast = useToast();
  const list = useAsync(() => api.seasons.staffList(venue.id), [venue.id]);
  const seasons = useAsync(() => api.seasons.list(venue.id), [venue.id]);
  // Invoiced slots need the hall's invoicing details: the sheet says so before staff try.
  const billing = useAsync(() => api.billing.getSettings(venue.id).catch(() => null), [venue.id]);
  const [sheet, setSheet] = useState(null); // { mode, slot }
  const [sheetOpen, setSheetOpen] = useState(false);

  const open = (mode, slot = null) => { setSheet({ mode, slot }); setSheetOpen(true); };
  const done = (message) => {
    setSheetOpen(false);
    if (message) toast(message, { icon: 'check' });
    list.reload({ silent: true });
    onChanged?.();
  };

  const slots = list.data || [];
  const requests = slots.filter((s) => s.status === 'requested');
  const active = slots.filter((s) => s.status === 'active');
  const others = slots.filter((s) => !['requested', 'active'].includes(s.status));
  const byDay = [1, 2, 3, 4, 5, 6, 7].map((d) => ({ day: d, slots: active.filter((s) => s.weekday === d) })).filter((g) => g.slots.length);
  const canCreate = (seasons.data || []).length > 0;

  return (
    <div className="bhall-view">
      <div className="bhall-view-head">
        <div>
          <h2 className="bhall-view-title">Kausivuorot</h2>
          <p className="bhall-view-sub">{(seasons.data || []).map((s) => `${s.name} ${dayMonth(s.startsOn)}–${dayMonth(s.endsOn, true)}`).join(' · ') || 'Ei kausia'}</p>
        </div>
        {canCreate ? <Button variant="dark" size="sm" icon="plus" onClick={() => open('create')}>Uusi kausivuoro</Button> : seasons.data && (
          <Button variant="dark" size="sm" icon="settings" onClick={() => navigate(`/pelaa/halli/${venue.slug}?nakyma=asetukset`)}>Lisää kausi</Button>
        )}
      </div>

      {list.loading && !list.data ? (
        <div className="stack-3"><Skeleton h={96} r={16} /><Skeleton h={180} r={16} /></div>
      ) : list.error && !list.data ? (
        <ErrorState error={list.error} onRetry={() => list.reload()} compact />
      ) : (
        <>
          <section aria-labelledby="hs-requests">
            <h3 className="bhall-subhead" id="hs-requests">Hakemukset{requests.length ? <span className="bhall-count">{requests.length}</span> : null}</h3>
            {requests.length === 0 ? (
              <p className="ss-empty">Ei käsittelemättömiä hakemuksia.</p>
            ) : (
              <div className="hs-requests">
                {requests.map((s) => (
                  <article key={s.id} className="hs-request">
                    <div className="hs-request-who">
                      {s.holder && <Avatar person={s.holder} name={s.holderName} size={36} />}
                      <span>
                        <b>{s.holderName}</b>
                        <small>Haki {dayMonth(s.createdAt.slice(0, 10))} · {s.billing === 'card' ? 'kortilta kuukausittain' : 'lasku'}</small>
                      </span>
                    </div>
                    <p className="hs-request-when">{WEEKDAY_NAMES[s.weekday - 1]} {slotWhen(s).split(' ')[1]}</p>
                    <p className="hs-request-meta">
                      {s.courtName ? s.courtName : 'Mikä tahansa kenttä'}{s.locationName ? ` · ${s.locationName}` : ''} · {s.weeks} krt · arvio {centsLabel(s.priceCents)}
                    </p>
                    {s.note && <p className="hs-request-note">“{s.note}”</p>}
                    <Button variant="lime" size="sm" icon="check" onClick={() => open('approve', s)}>Käsittele</Button>
                  </article>
                ))}
              </div>
            )}
          </section>

          <section aria-labelledby="hs-active">
            <h3 className="bhall-subhead" id="hs-active">Voimassa<span className="bhall-count is-quiet">{active.length}</span></h3>
            {byDay.length === 0 ? (
              <p className="ss-empty">Ei voimassa olevia kausivuoroja.</p>
            ) : (
              <div className="hs-days">
                {byDay.map((g) => (
                  <div key={g.day} className="hs-day">
                    <span className="hs-day-name">{WEEKDAY_NAMES[g.day - 1]}</span>
                    <ul className="hs-rows">
                      {g.slots.sort((a, b) => a.startTime.localeCompare(b.startTime)).map((s) => {
                        const billing = billingText(s);
                        const failed = s.charges.some((c) => c.status === 'failed');
                        return (
                          <li key={s.id}>
                            <button type="button" className="hs-row" onClick={() => open('view', s)}>
                              <span className="hs-row-time t-num">{slotWhen(s).split(' ')[1]}</span>
                              <span className="hs-row-court">{s.courtName}<small>{s.locationName}</small></span>
                              <span className="hs-row-holder truncate">{s.holderName}</span>
                              <span className="hs-row-billing">
                                {s.invoice ? <InvoiceStateChip invoice={s.invoice} /> : <span className={cx('hs-billing', failed && 'is-failed')}>{failed && <Icon name="alert" size={13} />}{billing}</span>}
                              </span>
                              <span className="hs-row-next">{s.nextAt ? formatGameTime(s.nextAt) : '—'}</span>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                ))}
              </div>
            )}
          </section>

          {others.length > 0 && (
            <Disclosure title="Päättyneet ja hylätyt" summary={`${others.length}`} icon="archive">
              <ul className="hs-rows">
                {others.map((s) => (
                  <li key={s.id}>
                    <button type="button" className="hs-row is-quiet" onClick={() => open('view', s)}>
                      <span className="hs-row-time">{slotWhen(s)}</span>
                      <span className="hs-row-holder truncate">{s.holderName}</span>
                      <SlotStatusChip status={s.status} />
                    </button>
                  </li>
                ))}
              </ul>
            </Disclosure>
          )}
        </>
      )}

      <SeasonStaffSheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        mode={sheet?.mode}
        slot={sheet?.slot}
        venue={venue}
        seasons={seasons.data || []}
        billingReady={billing.data?.ready !== false}
        onDone={done}
      />
    </div>
  );
}
