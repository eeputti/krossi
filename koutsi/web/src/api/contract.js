// contract.js — the data layer's interface. Both backends (api/supabase, api/demo) must
// implement exactly these functions; test/contract.test.mjs fails on a missing or extra one.
// Every function is async and throws ApiError (api/errors.js) on failure.
//
// Shapes are the old Koutsi's state shapes (see lib/koutsi-data.js mappers), so the domain
// helpers in domain/core.js run unchanged on them:
//
//   CoachState  { coach, coaches: [coach], students: Student[], groups: Group[], trainings: Training[],
//                 exercises: Exercise[], clubEvents: ClubEvent[] }
//   PlayerState { coach, coaches, students: [me, ...rosterStubs], groups, trainings, exercises, clubEvents }
//   Group       { id, coachId, name, level, day: 'Ma'…'Su', time: 'HH:MM', durationMinutes, memberIds,
//                 slots: [{ id, day, time, durationMinutes }], themes, theme, upcomingThemes, pastThemes, annualPlan }
//   Theme       { id, year, week, title, lead }
//   Training    { id, date, time, type, durationMinutes, loggedBy: 'coach'|'player', notes, endDate,
//                 studentId, groupId, coachId, seriesId, absences: [{ studentId, reason, reportedBy, updatedAt }] }
//   Student     { id, name, initial, hue, avatarUrl, isPlaceholder, age, ageValue, ageLabel, level, goal,
//                 playerNote, playerWish, joinedAt, welcomeSeenAt, diary, homework, videos, moods,
//                 matchNotes, goalHistory, wishHistory, noteHistory }   (roster stubs: { id, name, …, rosterOnly })

export const API_CONTRACT = {
  // Session and sign-in. onChange(cb) → unsubscribe; cb(event, session).
  auth: ['getSession', 'onChange', 'signInWithPassword', 'signUp', 'signInWithOAuth', 'resetPassword',
    'resendConfirmation', 'updatePassword', 'signOut'],

  // The shared Krossi profile row and account-level actions.
  account: ['getProfile', 'getPilotAcknowledgement', 'acceptPilot', 'createProfile', 'saveDisplayName',
    'uploadAvatar', 'recordAppOpen', 'isAdmin', 'submitFeedback', 'exportMyData', 'deleteAccount'],

  // Coach role: fetchRow(uid) → { id } | null; load(coachId) → CoachState; subscribe(coachId, cb) → unsubscribe.
  coach: ['fetchRow', 'load', 'redeemKey', 'markWelcomeSeen', 'saveProfile', 'subscribe'],

  // Player role: fetchRow(uid) → { id } | null; load(studentId) → PlayerState; and the player's own writes.
  player: ['fetchRow', 'load', 'subscribe', 'markWelcomeSeen', 'saveGoal', 'saveNote', 'saveWish', 'saveAge',
    'addMood', 'setMoodHidden', 'deleteMood', 'addMatchNote', 'updateMatchNote', 'deleteMatchNote',
    'addSelfTraining', 'deleteSelfTraining'],

  // A coach's roster.
  students: ['create', 'bulkSetup', 'setLevel', 'updatePlaceholder', 'endCoaching', 'merge', 'deletePlaceholder',
    'placeholderJoinCode'],

  groups: ['create', 'update', 'remove', 'addMembers', 'removeMember', 'addSlot', 'deleteSlot', 'extendSeries'],

  // save(rows: [{ groupId, year, week, title, lead }], { onlyNew }) → rows written.
  themes: ['save', 'remove'],

  trainings: ['add', 'update', 'updateSeries', 'remove', 'removeSeries', 'countSeriesRemaining'],

  // set(trainingIds, studentId, 'paikalla' | 'poissa')
  attendance: ['set'],

  // Coach's notes to a player (koutsi_diary_entries) and homework.
  notes: ['add', 'update', 'remove'],
  homework: ['add', 'update', 'remove', 'toggleDone'],

  videos: ['share', 'setRecipients', 'url', 'remove'],
  exercises: ['add', 'update', 'remove', 'setVideo', 'removeVideo', 'seedStarters'],
  events: ['add', 'update', 'remove'],

  invites: ['myJoinCode', 'rotateJoinCode', 'create', 'list', 'revoke', 'redeem', 'claim', 'matchUnclaimed',
    'unclaimedForCode'],

  plans: ['upload', 'url', 'remove', 'uploadShared', 'submissions'],

  // list(uid), markRead(uid), getEmailPref(uid), setEmailPref(uid, enabled), subscribe(uid, cb) → unsubscribe
  notifications: ['list', 'markRead', 'getEmailPref', 'setEmailPref', 'subscribe'],

  // Ylläpito — every RPC behind these re-checks koutsi_is_admin() server-side.
  admin: ['users', 'feedback', 'deleteFeedback', 'deleteUser', 'actAs', 'groups', 'bulkInviteCodes',
    'pendingPlans', 'publishPlan', 'handleSubmission', 'uploadPlan'],
};

// Functions that return synchronously-usable values (subscriptions) — not wrapped in
// error conversion because they return an unsubscribe function, not a promise.
export const SYNC_FUNCTIONS = new Set(['auth.onChange', 'coach.subscribe', 'player.subscribe', 'notifications.subscribe']);
