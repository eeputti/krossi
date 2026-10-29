// OpenSlots.jsx (player) — Vapaat ajat: the free times the player's coaches have published. Koti shows
// the soonest ones while there are any (OpenSlotsBlock); /pelaaja/vapaat (the notice's link, "Kaikki")
// lists them all over Koti (OpenSlotsSheet). A tap asks "Varaa aika?" once and books it; the first one
// wins, and the booking is an ordinary private lesson that shows in Treenit at once. Cancelling it is
// the usual "En pääse". Nothing shows while the database has no slots (state.openSlotsReady).
import { useState } from 'react';
import { api } from '../api/index.js';
import { useData } from '../app/data.jsx';
import { goBack, navigate } from '../app/router.js';
import { EmptyState, Icon, Sheet, useConfirm, useToast } from '../ui/index.js';
import { Block } from '../shared/bits.jsx';
import { koutsiCoachById } from '../domain/core.js';
import { minutesLabel, relativeDay, shortDay } from '../domain/week.js';
import { openToBook, slotsByDay, slotStartLabel, slotWhen } from '../domain/openSlots.js';

const HOME_ROWS = 3;

/** A coach's name on a slot only when the player has more than one coach. */
function coachLabel(state, slot) {
  if ((state.coaches || []).length < 2) return '';
  return koutsiCoachById(state, slot.coachId)?.name || '';
}

/** "Varaa aika?" → book → "Varattu". A time someone else took first refreshes the list. */
export function useBookSlot() {
  const { state, run, reload } = useData();
  const confirm = useConfirm();
  const toast = useToast();
  const [busy, setBusy] = useState(null);
  const book = async (slot) => {
    if (busy) return;
    const coach = koutsiCoachById(state, slot.coachId)?.name;
    const ok = await confirm({
      title: 'Varaa aika?',
      message: [slotWhen(slot), slot.place, coach].filter(Boolean).join(' · '),
      confirmLabel: 'Varaa',
    });
    if (!ok) return;
    setBusy(slot.id);
    const res = await run(() => api.openSlots.book(slot.id), null);
    setBusy(null);
    if (res.ok) toast(`Varattu: ${slotStartLabel(slot)}. Tunti on nyt viikossasi.`);
    else reload().catch(() => {});
  };
  return { book, busy };
}

/** One free time; under a day's heading only the time (`showDate` on Koti). */
function SlotRow({ slot, state, onBook, busy, showDate = false }) {
  const sub = [coachLabel(state, slot), slot.place].filter(Boolean).join(' · ');
  return (
    <button type="button" className="k-row" onClick={() => onBook(slot)} aria-busy={busy || undefined}>
      {showDate
        ? <span className="k-session-time"><span className="k-session-date">{relativeDay(slot.date)}</span><span className="t-num">{slot.time}</span></span>
        : <span className="k-group-time t-num">{slot.time}</span>}
      <span className="k-row-main">
        <span className="k-row-title truncate">Yksityistunti · {minutesLabel(slot.durationMinutes)}</span>
        {sub && <span className="k-row-sub truncate">{sub}</span>}
      </span>
      <Icon name="chevron-right" size={18} className="k-chevron" />
    </button>
  );
}

/** Koti: the soonest free times, while there are any. */
export function OpenSlotsBlock() {
  const { state } = useData();
  const { book, busy } = useBookSlot();
  if (!state.openSlotsReady) return null;
  const open = openToBook(state.openSlots);
  if (!open.length) return null;
  return (
    <Block title="Vapaat ajat">
      <div className="k-list">
        {open.slice(0, HOME_ROWS).map((s) => <SlotRow key={s.id} slot={s} state={state} onBook={book} busy={busy === s.id} showDate />)}
        {open.length > HOME_ROWS && (
          <button type="button" className="k-textlink" onClick={() => navigate('/pelaaja/vapaat', { overlay: true })}>
            Kaikki vapaat ajat ({open.length})<Icon name="chevron-right" size={14} />
          </button>
        )}
      </div>
    </Block>
  );
}

/** /pelaaja/vapaat — every free time, by day, over Koti. */
export function OpenSlotsSheet() {
  const { state } = useData();
  const { book, busy } = useBookSlot();
  const open = state.openSlotsReady ? openToBook(state.openSlots) : [];
  const close = () => goBack('/pelaaja/koti');
  return (
    <Sheet open onClose={close} title="Vapaat ajat" subtitle={open.length ? 'Napauta aikaa varataksesi sen.' : null} size="md">
      {open.length === 0 ? (
        <EmptyState art="calendar" title="Ei vapaita aikoja" text="Valmentajasi uudet vapaat ajat näkyvät täällä ja Kodissa." />
      ) : (
        <div className="stack-5">
          {slotsByDay(open).map((d) => (
            <section key={d.date} className="k-day-section">
              <h2 className="k-day-title">{relativeDay(d.date) === shortDay(d.date) ? shortDay(d.date) : `${relativeDay(d.date)} · ${shortDay(d.date)}`}</h2>
              <div className="k-list">
                {d.slots.map((s) => <SlotRow key={s.id} slot={s} state={state} onBook={book} busy={busy === s.id} />)}
              </div>
            </section>
          ))}
        </div>
      )}
    </Sheet>
  );
}
