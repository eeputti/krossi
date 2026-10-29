// OpenSlots.jsx (player) — Vapaat ajat: the free times the player's coaches have published live in
// Viikko's calendar as dashed "Vapaa aika" blocks (TrainingsScreen); a tap asks "Varaa aika?" once and
// books it. The first one wins, and the booking is an ordinary private lesson that fills the block at
// once. Cancelling it is the usual "En pääse". Koti shows one line while there are free times (how
// many, the soonest) that opens the week of the soonest; /pelaaja/vapaat (the notice's link) goes there
// too. Nothing shows while the database has no slots (state.openSlotsReady).
import { useEffect, useState } from 'react';
import { api } from '../api/index.js';
import { useData } from '../app/data.jsx';
import { navigate } from '../app/router.js';
import { Button, useConfirm, useToast } from '../ui/index.js';
import { koutsiCoachById, koutsiIsoWeekOfDateStr } from '../domain/core.js';
import { weekParam } from '../domain/week.js';
import { openToBook, slotStartLabel, slotWhen } from '../domain/openSlots.js';

/** Viikko on the day of a free time. */
const weekPathOf = (date) => `/pelaaja/treenit?vko=${weekParam(koutsiIsoWeekOfDateStr(date))}&pv=${date}`;

/** "Varaa aika?" → book → "Varattu". A time someone else took first refreshes the week. */
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

/** Koti: one line while there are free times — how many, the soonest — and the way to the week. */
export function OpenSlotsCard() {
  const { state } = useData();
  if (!state.openSlotsReady) return null;
  const open = openToBook(state.openSlots);
  if (!open.length) return null;
  const first = open[0];
  const coach = (state.coaches || []).length > 1 ? koutsiCoachById(state, first.coachId)?.name : '';
  return (
    <div className="k-banner-card">
      <div className="grow">
        <div className="k-banner-title">{open.length === 1 ? '1 vapaa aika' : `${open.length} vapaata aikaa`}</div>
        <div className="k-banner-sub">Lähin {slotStartLabel(first)}{coach ? ` · ${coach}` : ''}</div>
      </div>
      <Button variant="dark" size="sm" onClick={() => navigate(weekPathOf(first.date))}>Valitse aika</Button>
    </div>
  );
}

/** /pelaaja/vapaat (the notice's link): the week of the soonest free time, else this week. */
export function OpenSlotsRedirect() {
  const { state } = useData();
  const first = state.openSlotsReady ? openToBook(state.openSlots)[0] : null;
  const to = first ? weekPathOf(first.date) : '/pelaaja/treenit';
  useEffect(() => { navigate(to, { replace: true }); }, [to]);
  return null;
}
