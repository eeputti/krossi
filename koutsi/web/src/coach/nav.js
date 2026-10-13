// nav.js — where things live in the coach app, so screens link by intent, not by string.
import { navigate } from '../app/router.js';
import { weekParam } from '../domain/week.js';

export const groupPath = (id) => `/valmentaja/ryhma/${encodeURIComponent(id)}`;
export const playerPath = (id) => `/valmentaja/pelaaja/${encodeURIComponent(id)}`;
export const sessionPath = (id) => `/valmentaja/treeni/${encodeURIComponent(id)}`;
export const exercisePath = (id) => `/valmentaja/harjoite/${encodeURIComponent(id)}`;

/** The weekly theme planner, as a sheet over the current page. */
export function openPlanner({ week, groupId } = {}) {
  const q = new URLSearchParams();
  if (week) q.set('vko', weekParam(week));
  if (groupId) q.set('ryhma', groupId);
  const s = q.toString();
  navigate(`/valmentaja/teemat${s ? `?${s}` : ''}`, { overlay: true });
}

export function openInvites() {
  navigate('/valmentaja/kutsut', { overlay: true });
}
