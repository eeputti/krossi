// contract.js — the one data-layer interface every screen talks to.
//
// There are two implementations of it:
//   api/supabase/*.js  — the real backend (production Supabase project, shared with Koutsi)
//   api/demo/*.js      — an in-memory backend used by krossi.app/demo
//
// Screens only ever do `import { api } from '../api'` and call `api.<domain>.<fn>()`.
// They never import supabase-js directly, so the demo can never drift from the product:
// test/contract.test.mjs fails the build if either implementation is missing a function.
//
// Conventions
// - Every function is async (returns a Promise), even trivial ones.
// - Errors are thrown as ApiError (api/errors.js) with a Finnish `userMessage` that the UI
//   can show as-is. Unknown errors get a generic message; the raw error is kept on `cause`.
// - Data is camelCase. Rows are mapped at the edge (api/supabase/map.js), never in screens.
// - Avatar/chat image fields are already full URLs (or null) — screens never build URLs.
// - Dates are ISO strings.
//
// ── Shared shapes ────────────────────────────────────────────────────────────
//
// @typedef {'aloittelija'|'keskitaso'|'edistynyt'|'kilpapelaaja'} SkillLevel
// @typedef {'blue'|'yellow'|'red'|'green'} AvatarColor
//
// @typedef {Object} PersonLite
// @property {string} id
// @property {string} name            first name / display name, 'Pelaaja' when unknown
// @property {string|null} avatarUrl  full URL
// @property {AvatarColor} avatarColor
// @property {string|null} [ageRange]
// @property {SkillLevel|null} [skillLevel]
//
// @typedef {Object} Profile
// @property {string} id
// @property {string} name
// @property {string|null} ageRange          'alle20' | '20-30' | ... | '60+' (legacy: plain number string)
// @property {'mies'|'nainen'|null} gender
// @property {string} city                   primary home city ('' if none)
// @property {string[]} areas                all cities (first = city)
// @property {string|null} bio
// @property {string|null} avatarUrl
// @property {AvatarColor} avatarColor
// @property {SkillLevel} skillLevel
// @property {string[]} competitionClasses    e.g. ['B1','B2'] (only meaningful for kilpapelaaja)
// @property {string[]} playStyles            values from PLAY_STYLES
// @property {string[]} availability          values from AVAILABILITY_SLOTS
// @property {string|null} handedness         'oikeakätinen' | 'vasenkätinen'
// @property {string|null} backhand           'yhden käden' | 'kahden käden'
// @property {boolean} playingThisWeek
// @property {string|null} playingNowUntil    ISO; "Pelaan nyt" active while in the future
// @property {string|null} playingNowNote
// @property {boolean} hiddenFromFeed
// @property {boolean} isKrossiPlayer        false = account created by Krossi Koutsi, needs Krossi onboarding
// @property {boolean} isDiscoverable        false = private Koutsi profile (only an explicit opt-in changes it)
// @property {string|null} paidAt
// @property {string|null} createdAt
//
// @typedef {Object} ProfileInput            what onboarding / profile edit saves
// @property {string} name
// @property {string|null} ageRange
// @property {'mies'|'nainen'|null} gender
// @property {string[]} areas
// @property {string|null} bio
// @property {SkillLevel} skillLevel
// @property {string[]} competitionClasses
// @property {string[]} playStyles
// @property {string[]} availability
// @property {string|null} handedness
// @property {string|null} backhand
// @property {boolean} hiddenFromFeed
// @property {boolean} [playingThisWeek]
// @property {string|null} [avatarPath]      storage path returned by profile.uploadAvatar
// @property {boolean} [discoverable]         true = opt a private Koutsi profile into Krossi player search
//
// @typedef {Object} Game                    a row in `challenges` ("haaste" / "tapahtuma")
// @property {string} id
// @property {'open'|'event'} kind
// @property {'open'|'filled'|'cancelled'} status
// @property {'played'|'not_played'|null} outcome
// @property {PersonLite} creator
// @property {PersonLite[]} participants     joiners, NOT including the creator
// @property {number} capacity               how many joiners fit (same formula as join_challenge RPC)
// @property {number} spotsLeft              max(0, capacity - participants.length)
// @property {'kaksinpeli'|'nelinpeli'|'pallottelu'} matchType
// @property {string} locationName
// @property {'sisätennis'|'ulkotennis'|'missä vain'} locationType
// @property {string|null} courtSurface
// @property {string|null} city
// @property {number|null} lat
// @property {number|null} lng
// @property {string|null} scheduledAt        null = "aika avoin"
// @property {string|null} expiresAt
// @property {string|null} title
// @property {string|null} description
// @property {SkillLevel|null} minSkillLevel
// @property {number|null} courtPrice
// @property {boolean} creatorCoversFull
// @property {number|null} maxPlayers
// @property {string} createdAt
// @property {boolean} isMine                 creator is the current user
// @property {boolean} iJoined
// @property {boolean} onWaitlist
// @property {number} waitlistCount          only accurate for my own games / games I'm in (RLS) — show it only when isMine || iJoined
// @property {string|null} conversationId     group chat of the game, if one exists and is visible
//
// @typedef {Object} GameInput
// @property {'open'|'event'} kind
// @property {string} matchType
// @property {string} locationType
// @property {string} locationName            '' -> stored as 'Avoin'
// @property {string} city
// @property {number|null} lat
// @property {number|null} lng
// @property {string|null} scheduledAt         ISO
// @property {string|null} title
// @property {string|null} description
// @property {string|null} courtSurface
// @property {SkillLevel|null} minSkillLevel
// @property {number|null} courtPrice
// @property {boolean} creatorCoversFull
// @property {number|null} maxPlayers          events only
//
// @typedef {Object} PublicGamePreview        what a logged-out visitor of a shared link sees
// @property {string} id
// @property {'open'|'event'} kind
// @property {'open'|'filled'|'cancelled'} status
// @property {string} creatorName
// @property {AvatarColor} creatorAvatarColor
// @property {string} matchType
// @property {string} locationName
// @property {string} locationType
// @property {string|null} city
// @property {string|null} scheduledAt
// @property {string|null} title
// @property {number} spotsLeft
// @property {number} participantCount
//
// @typedef {Object} GameInvite
// @property {string} id
// @property {Game} game
//
// @typedef {Object} Conversation
// @property {string} id
// @property {boolean} isGroup
// @property {string} title                   other person's name, or game title / 'Ryhmäkeskustelu'
// @property {PersonLite[]} participants      everyone except me
// @property {{text:string, senderId:string|null, createdAt:string, kind:string}|null} lastMessage
// @property {string} updatedAt
// @property {boolean} unread
// @property {string|null} gameId
//
// @typedef {Object} Message
// @property {string} id
// @property {string} conversationId
// @property {string} senderId
// @property {PersonLite} sender
// @property {'text'|'thumbs'|'image'|'join'} kind
// @property {string|null} text
// @property {string|null} imageUrl
// @property {string} createdAt
// @property {Object|null} meta               parsed JSON payload for 'join' messages
//
// @typedef {Object} PlayRequest
// @property {string} id
// @property {PersonLite} from
// @property {string} message
// @property {string} createdAt
//
// @typedef {Object} MatchResult
// @property {string} id
// @property {string} createdAt
// @property {'sets'|'tiebreak'|'full_match'} gameType
// @property {'singles'|'doubles'} format
// @property {string|null} partnerName
// @property {string|null} opponentName
// @property {string|null} oppPartnerName
// @property {{my:number, opp:number}[]} sets
// @property {boolean} won
//
// @typedef {Object} Partner                  "pelikaveri": someone you have actually played with
// @property {PersonLite} player
// @property {number} gamesTogether
// @property {string|null} lastPlayedAt
//
// @typedef {Object} Activity                 everything gamification / recaps are computed from
// @property {{id:string, playedAt:string, matchType:string, kind:string, locationName:string, locationType:string, city:string|null, isOrganizer:boolean, people:PersonLite[]}[]} games   challenges with outcome 'played'
// @property {MatchResult[]} results
// @property {{id:string, playedAt:string, won:boolean, opponent:PersonLite, sets:{a:number,b:number}[], leagueId:string}[]} leagueMatches  confirmed league fixtures I played
// @property {number} organizedCount           challenges I created (any status except cancelled)
// @property {number} invitesJoined            people who signed up through my invite link
// @property {string|null} memberSince
//
// @typedef {Object} LeagueSummary
// @property {string} id
// @property {string} city
// @property {SkillLevel} skillLevel
// @property {string} seasonLabel
// @property {number} groupSize
// @property {'signup'|'active'|'finished'} status
// @property {number} memberCount
// @property {string} createdBy
// @property {boolean} iAmMember
//
// @typedef {Object} LeagueDetail
// @property {string} id  ...all LeagueSummary fields
// @property {(PersonLite & {groupNumber:number|null})[]} members
// @property {{id:string, groupNumber:number, playerA:PersonLite, playerB:PersonLite,
//             result:null|{sets:{a:number,b:number}[], winnerId:string, reportedBy:string, confirmedBy:string|null, confirmedAt:string|null}}[]} fixtures
//
// @typedef {Object} NotificationPrefs
// @property {boolean} emailEnabled           master switch for email (new column)
// @property {boolean} playRequests
// @property {boolean} messages
// @property {boolean} areaGames              new games in my city
// @property {boolean} gameJoins
// @property {boolean} gameInvites
// @property {boolean} playingNow             "pelaan nyt" emails from others
//
// @typedef {Object} NotifyEvent              same shapes as the send-push-notification edge function
//   { type:'play_request', senderId, receiverId }
//   { type:'new_message', conversationId, senderId, hasImage, isThumbsUp }
//   { type:'new_area_challenge', challengeId, creatorId, area }
//   { type:'new_area_event', challengeId, creatorId, area }
//   { type:'challenge_join', challengeId, challengeCreatorId, joinerId }
//   { type:'challenge_invite', challengeId, inviterId, invitedUserId }
//   { type:'challenge_spot_available', challengeId, leaverId }
//   { type:'challenge_cancelled', challengeId, creatorId }
//   { type:'account_report', reportId, reporterId, reportedId }

/**
 * Function names per domain. Both implementations must export exactly these.
 * The comment after each name is its signature and return value.
 */
export const API_CONTRACT = {
  auth: [
    'getSession',          // () -> Session|null   ({ user: { id, email } })
    'onChange',            // (cb(event, session)) -> unsubscribe()   (sync return wrapped in a Promise is NOT ok here — returns the function directly)
    'signInWithPassword',  // (email, password) -> void
    'signUp',              // (email, password) -> { needsConfirmation:boolean }
    'resetPassword',       // (email) -> void
    'signInWithOAuth',     // ('google'|'apple') -> void   (redirects back to /pelaa)
    'signOut',             // () -> void
    'getIdentities',       // () -> string[]   e.g. ['email','google']
    'updatePassword',      // (newPassword) -> void   used after a password-reset link (auth event 'PASSWORD_RECOVERY')
  ],
  profile: [
    'getMine',             // (uid) -> Profile|null
    'saveMine',            // (uid, ProfileInput) -> Profile
    'uploadAvatar',        // (uid, File) -> storagePath   (resized to max 800px JPEG client-side)
    'setPlayingThisWeek',  // (uid, boolean) -> void
    'startPlayingNow',     // ({ minutes, note }) -> { sent:number, warning?:string }
    'stopPlayingNow',      // (uid) -> void
    'recordAppOpen',       // () -> void   (fire and forget)
    'isAdmin',             // () -> boolean
    'myEventCities',       // () -> string[]   cities where I may create events (admin = all)
    'getKoutsiAgeGroup',   // () -> 'adult'|'junior_13_17'|'child_under_13'|null   (Koutsi pilot age group of a shared account)
    'deleteAccount',       // () -> void   (also signs out)
  ],
  players: [
    'list',                // ({ city }) -> Profile[]   visible, not hidden, not blocked, not me; requires paid (RLS)
    'get',                 // (id) -> Profile|null
    'sendPlayRequest',     // (toId, message) -> void   (also emits play_request notification)
    'listPartners',        // () -> Partner[]   sorted by gamesTogether desc, then lastPlayedAt desc
  ],
  games: [
    'listOpen',            // () -> Game[]   open|filled, kind open|event, not expired, sorted by scheduledAt asc (nulls last)
    'listMine',            // () -> { upcoming: Game[], past: Game[] }   created or joined; past = expired/cancelled/outcome set
    'get',                 // (id) -> Game|null
    'create',              // (GameInput) -> id   (emits new_area_challenge / new_area_event)
    'join',                // (id) -> conversationId   (emits challenge_join)
    'leave',               // (id) -> void   (emits challenge_spot_available)
    'cancel',              // (id) -> void   (emits challenge_cancelled)
    'joinWaitlist',        // (id) -> void
    'leaveWaitlist',       // (id) -> void
    'invite',              // (gameId, userIds[]) -> { invited: id[], alreadyInvited: id[] }   (emits challenge_invite per NEW invite; existing invites can't be re-sent)
    'listInvites',         // () -> GameInvite[]   pending invites to me, for games still open
    'respondInvite',       // (inviteId, accept:boolean) -> conversationId|null   (accept = join)
    'pendingOutcomes',     // () -> Game[]   past games I'm in where outcome is still null
    'recordOutcome',       // (id, 'played'|'not_played') -> void
    'publicPreview',       // (id) -> PublicGamePreview|null   works without a session
  ],
  messages: [
    'listConversations',   // () -> Conversation[]   newest first
    'listRequests',        // () -> PlayRequest[]   pending, to me
    'acceptRequest',       // (id) -> conversationId
    'ignoreRequest',       // (id) -> void
    'getConversation',     // (id) -> Conversation|null
    'listMessages',        // (conversationId) -> Message[]   oldest first
    'send',                // (conversationId, text) -> Message   (emits new_message)
    'sendThumbs',          // (conversationId) -> Message
    'sendImage',           // (conversationId, File) -> Message   (resized to max 1600px JPEG)
    'markRead',            // (conversationId) -> void
    'deleteConversation',  // (id) -> void   (for everyone)
    'subscribe',           // (conversationId, onMessage(Message)) -> unsubscribe()   (returns the function directly)
    'subscribeInbox',      // (onChange()) -> unsubscribe()   fires on any new message / conversation change
    'unreadCount',         // () -> number   conversations with unread + pending requests
    'getArchived',         // () -> string[]   archived conversation ids (local to this browser)
    'setArchived',         // (ids[]) -> void
  ],
  results: [
    'listMine',            // () -> MatchResult[]   newest first, max 100
    'save',                // (id|null, Omit<MatchResult,'id'|'createdAt'>) -> void
    'remove',              // (id) -> void
  ],
  stats: [
    'myActivity',          // () -> Activity
  ],
  leagues: [
    'listByCity',          // (city) -> LeagueSummary[]   newest first
    'get',                 // (id) -> LeagueDetail|null
    'create',              // ({ city, skillLevel, seasonLabel }) -> id
    'join',                // (id) -> void
    'start',               // (id) -> void   (creator only, needs >= 4 members)
    'reportResult',        // (fixtureId, sets:{a,b}[], winnerId) -> void
    'confirmResult',       // (fixtureId) -> void
    'openFixtureChat',     // (fixtureId) -> conversationId
  ],
  social: [
    'listBlocked',         // () -> { rowId, user: PersonLite }[]
    'block',               // (userId) -> void
    'unblock',             // (rowId) -> void
    'report',              // (userId, reason) -> void
  ],
  notifications: [
    'getPrefs',            // () -> NotificationPrefs
    'savePrefs',           // (NotificationPrefs) -> void
    'emit',                // (NotifyEvent) -> void   never throws; push (mobile) + email (krossi-notify)
  ],
  invites: [
    'myCode',              // () -> string   short code; link = https://krossi.app/pelaa/kutsu/<code>
    'resolve',             // (code) -> { inviterName: string }|null   works without a session
    'claim',               // (code) -> void   called once after onboarding; ignores own/invalid codes
  ],
  payments: [
    'startCheckout',       // () -> void   redirects to Stripe Checkout
    'adminSetOwnPaid',     // (paid:boolean) -> void   admins only
  ],
  admin: [
    'stats',               // () -> object (krossi_admin_stats jsonb as-is)
    'users',               // () -> AdminUser[]
    'deleteUser',          // (userId) -> void
    'setCityAdmin',        // (userId, cities[]) -> void
  ],
};
