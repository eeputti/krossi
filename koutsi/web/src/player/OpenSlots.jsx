// OpenSlots.jsx (player) — Vapaat ajat: the free times the player's coaches have published live in
// Viikko's calendar as dashed "Vapaa aika" blocks (TrainingsScreen); a tap asks "Varaa aika?" once and
// books it. The first one wins, and the booking is an ordinary private lesson that fills the block at
// once (billed like one; nothing is paid when booking). Cancelling it is the usual "En pääse".
//
// Suggesting more lessons stays quiet (the owner's wish: upselling without pushing):
//   * "En pääse" offers up to three of the same coach's free times in the next two weeks under
//     "Korvaava aika?" — one choice books it and reports the absence at once (ReplacementSlots);
//   * Koti has one line while a free time is near and the player has none booked, with "Ei kiitos"
//     resting it for two weeks (OpenSlotsCard);
//   * no pop-ups, no badges, nothing for a known minor (the database shows them no slots either), and
//     the coach decides who a time is for. track() events tell Ylläpito → Käyttö whether it helps.
// /pelaaja/vapaat (the notice's link) opens the week of the soonest. Nothing shows while the database
// has no slots (state.openSlotsReady).
import { useEffect, useState } from 'react';
import { api } from '../api/index.js';
import { useData } from '../app/data.jsx';
import { navigate } from '../app/router.js';
import { Button, ChipSelect, Field, IconButton, useConfirm, useToast } from '../ui/index.js';
import { koutsiCoachById, koutsiFmtShortDate, koutsiIsoWeekOfDateStr } from '../domain/core.js';
import { weekParam } from '../domain/week.js';
import {
  SUGGEST_REST_DAYS, hasComingBooking, isMinor, openToBook, slotStartLabel, slotWhen, soonSlots,
} from '../domain/openSlots.js';

/** Viikko on the day of a free time. */
const weekPathOf = (date) => `/pelaaja/treenit?vko=${weekParam(koutsiIsoWeekOfDateStr(date))}&pv=${date}`;
/** One tap counted for Ylläpito → Käyttö (an event name only; never fails). */
const track = (name) => { api.account.trackEvent(name).catch(() => {}); };

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
      message: [slotWhen(slot), slot.place, coach].filter(Boolean).join(', '),
      confirmLabel: 'Varaa',
    });
    if (!ok) return;
    setBusy(slot.id);
    const res = await run(() => api.openSlots.book(slot.id), null);
    setBusy(null);
    if (res.ok) { track('vapaat.varattu'); toast(`Varattu: ${slotStartLabel(slot)}. Tunti on nyt viikossasi.`); } else reload().catch(() => {});
  };
  return { book, busy };
}

/**
 * "En pääse" → "Korvaava aika?": up to three of the lesson's coach's free times in the next two weeks.
 * A choice books it and reports the absence (`absentIds`) in one go; the plain "Ilmoita poissaolo" stays.
 */
export function ReplacementSlots({ training, absentIds, onDone }) {
  const { state, run, reload, ownerId } = useData();
  const confirm = useConfirm();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const me = state.students[0];
  const slots = state.openSlotsReady && !isMinor(me) ? soonSlots(state.openSlots, { coachId: training?.coachId }).slice(0, 3) : [];
  const shown = slots.length > 0;
  useEffect(() => { if (shown) track('vapaat.korvaava-nakyi'); }, [shown, training?.id]);
  if (!shown) return null;
  const replace = async (id) => {
    const slot = slots.find((s) => s.id === id);
    if (!slot || busy) return;
    const ok = await confirm({
      title: 'Varaa korvaava aika?',
      message: `${[slotWhen(slot), slot.place].filter(Boolean).join(', ')}. Poissaolo ilmoitetaan samalla valmentajalle.`,
      confirmLabel: 'Varaa',
    });
    if (!ok) return;
    setBusy(true);
    // the new time first: if someone took it, nothing else changes
    const res = await run(async () => {
      await api.openSlots.book(slot.id);
      await api.attendance.set(absentIds, ownerId, 'poissa');
    }, null);
    setBusy(false);
    if (!res.ok) { reload().catch(() => {}); return; }
    track('vapaat.korvaava-varattu');
    toast(`Poissaolo ilmoitettu ja korvaava aika varattu: ${slotStartLabel(slot)}.`);
    onDone();
  };
  return (
    <Field label="Korvaava aika?">
      <ChipSelect size="sm" ariaLabel="Korvaava aika" value={null} onChange={(id) => id && replace(id)}
        options={slots.map((s) => ({ value: s.id, label: `${koutsiFmtShortDate(s.date)} klo ${s.time}` }))} />
    </Field>
  );
}

const restKey = (uid) => `koutsi_vapaat_ei_kiitos_${uid}`;
function resting(uid) {
  try {
    const at = Number(localStorage.getItem(restKey(uid)) || 0);
    return at > 0 && Date.now() - at < SUGGEST_REST_DAYS * 86400000;
  } catch { return false; }
}

/**
 * Koti: one quiet line while a free time is near (two weeks) and the player has none booked — how many,
 * the soonest, and the way to that day in Viikko. "Ei kiitos" rests it for two weeks.
 */
export function OpenSlotsCard() {
  const { state, ownerId } = useData();
  const [rested, setRested] = useState(() => resting(ownerId));
  const near = state.openSlotsReady && !isMinor(state.students[0]) && !hasComingBooking(state.openSlots, ownerId)
    ? soonSlots(state.openSlots) : [];
  const shown = near.length > 0 && !rested;
  useEffect(() => { if (shown) track('vapaat.koti-nakyi'); }, [shown]);
  if (!shown) return null;
  const first = near[0];
  const coach = (state.coaches || []).length > 1 ? koutsiCoachById(state, first.coachId)?.name : '';
  const noThanks = () => {
    try { localStorage.setItem(restKey(ownerId), String(Date.now())); } catch { /* private mode: it shows again next time */ }
    track('vapaat.koti-ei-kiitos');
    setRested(true);
  };
  return (
    <div className="k-banner-card">
      <div className="grow">
        <div className="k-banner-title">{near.length === 1 ? '1 vapaa aika' : `${near.length} vapaata aikaa`}</div>
        <div className="k-banner-sub">Lähin {slotStartLabel(first)}{coach ? `, ${coach}` : ''}</div>
      </div>
      <Button variant="dark" size="sm" onClick={() => { track('vapaat.koti-valitse'); navigate(weekPathOf(first.date)); }}>Valitse aika</Button>
      <IconButton icon="close" size="sm" label="Ei kiitos" onClick={noThanks} />
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
