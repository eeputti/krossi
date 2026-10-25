// index.js — the Supabase backend: one object per contract domain (api/contract.js).
import { auth, account } from './account.js';
import { coach, player, students, groups, themes, trainings, attendance, notes, homework, announcements, events } from './coaching.js';
import { videos, exercises, plans } from './media.js';
import { invites, notifications, admin } from './people.js';
import { seasons } from './seasons.js';

export const backend = {
  auth, account, coach, player, students, groups, seasons, themes, trainings, attendance, notes, homework, announcements,
  videos, exercises, events, invites, plans, notifications, admin,
};
