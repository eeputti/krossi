// contract.js — the data layer's interface. Both backends (api/supabase, api/demo) must
// implement exactly these functions; test/contract.test.mjs fails on a missing or extra one.
// Every function is async and throws ApiError (api/errors.js) on failure.
//
// Shapes are the old Koutsi's state shapes (see lib/koutsi-data.js mappers), so the domain
// helpers in domain/core.js run unchanged on them:
//
//   CoachState  { coach, coaches: [coach], students: Student[], groups: Group[], trainings: Training[],
//                 exercises: Exercise[], clubEvents: ClubEvent[], weekNotes: [{ id, year, week, score, note, updatedAt }] }
//   PlayerState { coach, coaches, students: [me, ...rosterStubs], groups, trainings, exercises, clubEvents }
//   Group       { id, coachId, name, level, day: 'Ma'…'Su', time: 'HH:MM', durationMinutes, memberIds,
//                 slots: [{ id, day, time, durationMinutes }], themes, theme, upcomingThemes, pastThemes, annualPlan }
//   Theme       { id, year, week, title, lead }
//   Training    { id, date, time, type, durationMinutes, loggedBy: 'coach'|'player', notes, endDate,
//                 studentId, groupId, coachId, seriesId, absences: [{ studentId, reason, reportedBy, updatedAt }] }
//   Student     { id, name, initial, hue, avatarUrl, isPlaceholder, age, ageValue, ageLabel, level, goal,
//                 playerNote, playerWish, joinedAt, welcomeSeenAt, diary, homework, videos, moods,
//                 matchNotes, goalHistory, wishHistory, noteHistory, entries }   (roster stubs: { id, name, …, rosterOnly })
//   Entry       { id, at, date: 'YYYY-MM-DD', text, how }   the player's own "what I did, when, how it went"
//   CoachState / PlayerState also carry `entriesReady`: false while koutsi_player_entries is missing.

export const API_CONTRACT = {
  // Session and sign-in. onChange(cb) → unsubscribe; cb(event, session).
  auth: ['getSession', 'onChange', 'signInWithPassword', 'signUp', 'signInWithOAuth', 'resetPassword',
    'resendConfirmation', 'updatePassword', 'signOut'],

  // The shared Krossi profile row and account-level actions. trackEvent(name) counts one tap
  // (an event name, no content) for Ylläpito → Käyttö; it never throws.
  account: ['getProfile', 'getPilotAcknowledgement', 'acceptPilot', 'createProfile', 'saveDisplayName',
    'uploadAvatar', 'recordAppOpen', 'trackEvent', 'isAdmin', 'submitFeedback', 'exportMyData', 'deleteAccount'],

  // Coach role: fetchRow(uid) → { id } | null; load(coachId) → CoachState; subscribe(coachId, cb) → unsubscribe.
  // saveWeekNote(coachId, { year, week, score, note }) — the coach's private weekly diary.
  coach: ['fetchRow', 'load', 'redeemKey', 'markWelcomeSeen', 'saveProfile', 'saveWeekNote', 'subscribe'],

  // Player role: fetchRow(uid) → { id } | null; load(studentId) → PlayerState; and the player's own writes.
  // addMood → { id }; updateMood(moodId, { score?, note?, hiddenFromCoach? }).
  // addSelfTraining / updateSelfTraining(id, { coachId, date, endDate, time, type, durationMinutes, notes }) —
  // the player's own log (domain/ownWeek.js); every coach of the player reads it.
  // addEntry(studentId, { date, text, how }), updateEntry(entryId, { date, text, how }), deleteEntry(entryId) —
  // the Kehitys page's own entries (koutsi_player_entries); every linked coach reads them.
  player: ['fetchRow', 'load', 'subscribe', 'markWelcomeSeen', 'saveGoal', 'saveNote', 'saveWish', 'saveAge',
    'addMood', 'updateMood', 'setMoodHidden', 'deleteMood', 'addMatchNote', 'updateMatchNote', 'deleteMatchNote',
    'addSelfTraining', 'updateSelfTraining', 'deleteSelfTraining', 'saveAim', 'addEntry', 'updateEntry', 'deleteEntry',
    'archiveItem', 'unarchiveItem', 'forgetArchived', 'deleteHistory'],

  // A coach's roster.
  students: ['create', 'bulkSetup', 'setLevel', 'updatePlaceholder', 'endCoaching', 'merge', 'deletePlaceholder',
    'placeholderJoinCode'],

  groups: ['create', 'update', 'remove', 'addMembers', 'removeMember', 'addSlot', 'deleteSlot', 'extendSeries'],

  // Seasons — "Uusi kausi" (domain/season.js). CoachState carries `seasons` ([{ id, name, startsOn,
  // endsOn, breaks }]), groups a `seasonId`, the unpublished `seasonDraft` and `seasonsReady`
  // (false until the backend has seasons; the feature stays hidden). saveDraft(coachId, draft) keeps
  // the next season unseen by players; publish(coachId, draft) → { seasonId, groups, sessions } creates
  // the new season's groups, memberships and sessions at once (the old season stays as it was) and
  // sends each player one notification; removeDraft(coachId) throws the draft away;
  // update(seasonId, { name?, endsOn?, breaks? }) — "Muokkaa kautta" (the calendar is extended separately).
  seasons: ['saveDraft', 'removeDraft', 'publish', 'update'],

  // save(rows: [{ groupId, year, week, title, lead }], { onlyNew }) → rows written.
  themes: ['save', 'remove'],

  // setPlan(trainingId, plan) — "treenin runko" (domain/plan.js), kept in the session row's notes.
  trainings: ['add', 'update', 'updateSeries', 'remove', 'removeSeries', 'countSeriesRemaining', 'setPlan'],

  // set(trainingIds, studentId, 'paikalla' | 'poissa')
  attendance: ['set'],

  // Coach's notes to a player (koutsi_diary_entries) and homework. addMany writes one row per
  // player in one insert: each player gets their own copy (and their own notification).
  notes: ['add', 'addMany', 'update', 'remove'],
  homework: ['add', 'addMany', 'update', 'remove', 'toggleDone'],

  videos: ['share', 'setRecipients', 'url', 'remove'],
  exercises: ['add', 'update', 'remove', 'setVideo', 'removeVideo', 'seedStarters'],
  events: ['add', 'update', 'remove'],

  invites: ['myJoinCode', 'rotateJoinCode', 'create', 'list', 'revoke', 'redeem', 'claim', 'matchUnclaimed',
    'unclaimedForCode'],

  plans: ['upload', 'url', 'remove', 'uploadShared', 'submissions'],

  // list(uid), markRead(uid), getEmailPref(uid), setEmailPref(uid, enabled), subscribe(uid, cb) → unsubscribe
  notifications: ['list', 'markRead', 'getEmailPref', 'setEmailPref', 'subscribe'],

  // Ylläpito — every RPC behind these re-checks koutsi_is_admin() server-side.
  // usage(days | null) → [{ event, clicks, users, adminClicks, lastAt }] (admins' own taps apart).
  // usageOverview(days, includeTest) → the anonymous page/tap/error statistics of both Koutsi apps
  // (koutsi_admin_usage, fed by lib/koutsi-usage.js) — see coach/AdminUsage.jsx for the shape.
  admin: ['users', 'feedback', 'deleteFeedback', 'deleteUser', 'actAs', 'groups', 'bulkInviteCodes',
    'pendingPlans', 'publishPlan', 'handleSubmission', 'uploadPlan', 'usage', 'usageOverview'],
};

// Functions that return synchronously-usable values (subscriptions) — not wrapped in
// error conversion because they return an unsubscribe function, not a promise.
export const SYNC_FUNCTIONS = new Set(['auth.onChange', 'coach.subscribe', 'player.subscribe', 'notifications.subscribe']);
