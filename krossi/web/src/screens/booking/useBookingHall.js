// useBookingHall.js — the hall a player can book a court at from outside /pelaa/varaa: the
// "Varaa kenttä" door in Pelataanko?, "Varaa kenttä tälle pelille" on a game page and in a chat.
//
// Court booking shows in the demo and for admins until the first hall is live (the Lahti hall is
// is_public = false, so listVenues is empty for everybody else anyway). A hall counts when it is
// in one of `cities`. `anyCity` lets the menu fall back to the first hall for the demo and admins,
// whose own city may be elsewhere; a game or a chat never books a court in another city.
import { useMemo } from 'react';
import { api, isDemo } from '../../api/index.js';
import { useAsync } from '../../app/hooks.js';
import { useSession } from '../../app/session.jsx';

const norm = (s) => String(s || '').trim().toLocaleLowerCase('fi');

/** → { hall: BookingVenue|null, loading } */
export function useBookingHall(cities, { anyCity = false } = {}) {
  const { isAdmin } = useSession();
  const on = isDemo || Boolean(isAdmin);
  const venues = useAsync(() => (on ? api.booking.listVenues() : Promise.resolve([])), [on]);
  const key = (cities || []).map(norm).filter(Boolean).join('|');
  const hall = useMemo(() => {
    const list = venues.data || [];
    const wanted = new Set(key ? key.split('|') : []);
    return list.find((v) => wanted.has(norm(v.city))) || (anyCity ? list[0] || null : null);
  }, [venues.data, key, anyCity]);
  return { hall, loading: on && venues.loading && !venues.data };
}
