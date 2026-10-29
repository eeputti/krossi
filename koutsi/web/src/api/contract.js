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
//                 playerNote, playerWish, bio, area, playsHand, favouriteShot, playingSince, tennisStory, joinedAt, welcomeSeenAt, diary, homework, videos, moods,
//                 matchNotes, goalHistory, wishHistory, noteHistory, entries }   (roster stubs: { id, name, …, rosterOnly })
//   Entry       { id, at, date: 'YYYY-MM-DD', text, how }   the player's own "what I did, when, how it went"
//   CoachState / PlayerState also carry `entriesReady`: false while koutsi_player_entries is missing.

export const API_CONTRACT = {
  // Session and sign-in. onChange(cb) → unsubscribe; cb(event, session).
  auth: ['getSession', 'onChange', 'signInWithPassword', 'signUp', 'signInWithOAuth', 'resetPassword',
    'resendConfirmation', 'updatePassword', 'signOut'],

  // The shared Krossi profile row and account-level actions. saveAbout(uid, { bio, area }) writes the
  // profile's own words and home town (profiles.bio / area, shared with Krossi); removeAvatar(uid) clears the photo. trackEvent(name) counts one tap
  // (an event name, no content) for Ylläpito → Käyttö; it never throws.
  account: ['getProfile', 'getPilotAcknowledgement', 'acceptPilot', 'createProfile', 'saveDisplayName',
    'uploadAvatar', 'removeAvatar', 'saveAbout', 'recordAppOpen', 'trackEvent', 'isAdmin', 'submitFeedback', 'exportMyData', 'deleteAccount'],

  // Coach role: fetchRow(uid) → { id } | null; load(coachId) → CoachState; subscribe(coachId, cb) → unsubscribe.
  // saveWeekNote(coachId, { year, week, score, note }) — the coach's private weekly diary.
  coach: ['fetchRow', 'load', 'redeemKey', 'markWelcomeSeen', 'saveProfile', 'saveWeekNote', 'subscribe'],

  // Player role: fetchRow(uid) → { id } | null; load(studentId) → PlayerState; and the player's own writes.
  // addMood → { id }; updateMood(moodId, { score?, note?, hiddenFromCoach? }).
  // addSelfTraining / updateSelfTraining(id, { coachId, date, endDate, time, type, durationMinutes, notes }) —
  // the player's own log (domain/ownWeek.js); every coach of the player reads it.
  // addEntry(studentId, { date, text, how }), updateEntry(entryId, { date, text, how }), deleteEntry(entryId) —
  // the Kehitys page's own entries (koutsi_player_entries); every linked coach reads them.
  player: ['fetchRow', 'load', 'subscribe', 'markWelcomeSeen', 'saveGoal', 'saveNote', 'saveWish', 'saveAge', 'saveTennis',
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

  // Vapaat ajat (koutsi_open_slots, domain/openSlots.js): a coach publishes single free times, their own
  // players book them, and a booking is an ordinary private lesson (koutsi_trainings, Yksityistunti) for
  // both. CoachState / PlayerState carry `openSlots: Slot[]` (the coach: theirs from today on; a player:
  // the open ones of their coaches and their own bookings) and `openSlotsReady` (coach: the table is there
  // and the feature is on for them — off by default; player: the table is there).
  // add(coachId, [{ date, time, durationMinutes, place, audience: 'all' | 'private', sourceTrainingId? }]) → how
  // many were added (each player it is for gets one notice per publish; known minors none); remove(slotId) — an
  // open one; book(slotId) → { trainingId }.
  openSlots: ['add', 'remove', 'book'],

  // Coach's notes to a player (koutsi_diary_entries) and homework. addMany writes one row per
  // player in one insert: each player gets their own copy (and their own notification).
  // notes.addMany(coachId, ids, text, log?) / homework.addMany(ids, text, log?): with
  // log = { coachId, groupIds, refId? } (only while state.sendsReady) the sending also goes to Lähetetyt
  // and every copy carries its sendId (homework also its coachId).
  notes: ['add', 'addMany', 'update', 'remove'],
  homework: ['add', 'addMany', 'update', 'remove', 'toggleDone'],

  // Lähetetyt (koutsi_sends; domain/sends.js). CoachState carries `sends: [{ id, kind: 'video' | 'homework'
  // | 'note', videoId, refId, title, groupIds, studentIds, at }]` (newest first), `videoLibrary` (the coach's
  // own videos: [{ id, title, tags, at, hue, storagePath, externalUrl, mimeType, sizeBytes }]) and
  // `sendsReady` (false while the tables are missing: Lähetetyt and the Videot tab stay hidden).
  // update(sendId, text) — a homework's or note's every copy; remove(sendId) — takes it back from its players.
  sends: ['update', 'remove'],

  // Tiedotteet (koutsi_announcements): a practical notice to groups or players — a different coach
  // tomorrow, another court — shown on the players' Koti until `until` and never on anyone's
  // Kehitys; each addressed player gets a notification. add(coachId, { text, groupIds, studentIds,
  // until: 'YYYY-MM-DD' }) → { id }; remove(id). CoachState / PlayerState carry
  // `announcements: [{ id, coachId, text, groupIds, studentIds, until, at }]` and `announcementsReady`
  // (false while the table is missing: the Tiedote choice stays hidden).
  announcements: ['add', 'remove'],

  // Viestit (koutsi_threads / koutsi_messages, domain/messages.js): one conversation per coach–player
  // pair, off until the coach turns it on for the player (adults first). Only the two of them read it.
  // overview(role: 'coach' | 'player') → { ready, enabled, threads: Thread[] } — ready is false while the
  // tables are missing (everything stays hidden), enabled is the coach's feature gate (beta first) or,
  // for a player, whether any conversation is on. list(threadId) → Message[] (oldest first);
  // send(threadId, { body, refKind?, refId? }) → Message; remove(messageId) — one's own; markRead(threadId);
  // setEnabled(studentIds, on) → how many changed (coach); subscribe(cb) → unsubscribe: cb({ threadId })
  // on any change the signed-in user can see.
  messages: ['overview', 'list', 'send', 'remove', 'markRead', 'setEnabled', 'subscribe'],

  // Laskutus (koutsi_billers / koutsi_invoices / koutsi_invoice_lines, domain/billing.js). Kept out of the
  // coach's snapshot like Viestit. overview(coachId) → { ready, enabled, biller, invoices: Invoice[] (newest
  // first, with lines), memberships: [{ groupId, studentId, joinedAt, endedAt, groupCreatedAt }] } — ready is
  // false while the tables are missing, enabled is the per-coach gate (admins + koutsi_billing_coaches).
  // saveBiller(coachId, fields) → biller; createDrafts(coachId, drafts from domain draftsFrom()) → the new ids;
  // updateDraft(id, { payerName, payerEmail }); setLineCharged(lineId, charged); addLine(invoiceId,
  // { description, amountCents, date }); removeLine(lineId); removeDrafts(ids); send(ids) → [{ id, number }];
  // setPaid(id, paid); voidInvoice(id). Player: mine() → { ready, invoices (sent / paid, own), terms:
  // [{ coachId, sellerName, cancelHours, chargeLate, chargeNoShow, terms, paymentDays }] }.
  // byToken(token) → the invoice behind a link (no sign-in) or null.
  billing: ['overview', 'saveBiller', 'createDrafts', 'updateDraft', 'setLineCharged', 'addLine', 'removeLine', 'removeDrafts',
    'send', 'setPaid', 'voidInvoice', 'mine', 'byToken'],

  // share(...) — a player's own video, or a coach's before Lähetetyt; the coach's own videos:
  // save({ coachId, id?, title, tags, file | externalUrl, onProgress, signal }) → id,
  // shareSaved({ coachId, videoId, studentIds, groupIds, date? }) → { sendId, added } (only those without it),
  // updateSaved(videoId, { title, tags }), removeSaved(videoId) — from everyone, for good.
  videos: ['share', 'setRecipients', 'url', 'remove', 'save', 'shareSaved', 'updateSaved', 'removeSaved'],
  exercises: ['add', 'update', 'remove', 'setVideo', 'removeVideo', 'seedStarters'],
  events: ['add', 'update', 'remove'],

  invites: ['myJoinCode', 'rotateJoinCode', 'create', 'list', 'revoke', 'redeem', 'claim', 'matchUnclaimed',
    'unclaimedForCode'],

  plans: ['upload', 'url', 'remove', 'uploadShared', 'submissions'],

  // list(uid), markRead(uid), getEmailPrefs(uid) → { enabled, off: [category] }, setEmailPrefs(uid, { enabled, off }),
  // subscribe(uid, cb) → unsubscribe
  notifications: ['list', 'markRead', 'getEmailPrefs', 'setEmailPrefs', 'subscribe'],

  // Ylläpito — every RPC behind these re-checks koutsi_is_admin() server-side.
  // usage(days | null) → [{ event, clicks, users, adminClicks, lastAt }] (admins' own taps apart).
  // usageOverview(days, includeTest) → the anonymous page/tap/error statistics of both Koutsi apps
  // (koutsi_admin_usage, fed by lib/koutsi-usage.js) — see coach/AdminUsage.jsx for the shape.
  admin: ['users', 'feedback', 'deleteFeedback', 'deleteUser', 'actAs', 'groups', 'bulkInviteCodes',
    'pendingPlans', 'publishPlan', 'handleSubmission', 'uploadPlan', 'usage', 'usageOverview'],
};

// Functions that return synchronously-usable values (subscriptions) — not wrapped in
// error conversion because they return an unsubscribe function, not a promise.
export const SYNC_FUNCTIONS = new Set(['auth.onChange', 'coach.subscribe', 'player.subscribe', 'notifications.subscribe', 'messages.subscribe']);
