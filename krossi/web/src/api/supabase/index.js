// index.js — the real backend: production Supabase (project shared with Krossi Koutsi).
// Each domain module exports exactly its contract functions (test/contract.test.mjs checks
// for both missing and extra keys), so the namespaces can be used as-is.

import * as auth from './auth.js';
import * as profile from './profile.js';
import * as players from './players.js';
import * as games from './games.js';
import * as messages from './messages.js';
import * as results from './results.js';
import * as stats from './stats.js';
import * as leagues from './leagues.js';
import * as social from './social.js';
import * as notifications from './notifications.js';
import * as invites from './invites.js';
import * as payments from './payments.js';
import * as admin from './admin.js';

export const backend = {
  auth, profile, players, games, messages, results, stats, leagues, social, notifications, invites, payments, admin,
};
