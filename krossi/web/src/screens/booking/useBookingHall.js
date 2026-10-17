// useBookingHall.js — the hall a player can book a court at from outside /pelaa/varaa: the
// "Varaa kenttä" door in Pelataanko?, "Varaa kenttä tälle pelille" on a game page and in a chat.
//
// The database decides who sees a hall: listVenues returns the public halls, plus the hidden ones
// to their staff and admins (the Lahti hall is is_public = false until it opens to players). A hall
// counts when it is in one of `cities`. `anyCity` falls back to the first hall for a player whose own
// city is elsewhere (Omat); a game or a chat never books a court in another city.
import { useMemo } from 'react';
import { api } from '../../api/index.js';
import { useAsync } from '../../app/hooks.js';

const norm = (s) => String(s || '').trim().toLocaleLowerCase('fi');

/** → { hall: BookingVenue|null, loading } */
export function useBookingHall(cities, { anyCity = false } = {}) {
  const venues = useAsync(() => api.booking.listVenues(), []);
  const key = (cities || []).map(norm).filter(Boolean).join('|');
  const hall = useMemo(() => {
    const list = venues.data || [];
    const wanted = new Set(key ? key.split('|') : []);
    return list.find((v) => wanted.has(norm(v.city))) || (anyCity ? list[0] || null : null);
  }, [venues.data, key, anyCity]);
  return { hall, loading: venues.loading && !venues.data };
}
