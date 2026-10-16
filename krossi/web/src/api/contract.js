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
// @property {SkillLevel|'kaikki'} skillLevel
// @property {string} seasonLabel
// @property {number} groupSize               target group size (3–10)
// @property {'signup'|'active'|'finished'} status
// @property {'ladder'|'hallisarja'} format   ladder = Krossi-liiga (groups drawn once); hallisarja = rounds, organiser-made groups
// @property {'sets'|'timed'} matchFormat     timed = tunnin aikapeli: one row of games, draws allowed
// @property {number} currentRound            0 before the first round
// @property {boolean} isPublic               standings visible without an account (publicGet)
// @property {string|null} venue
// @property {string|null} description
// @property {number} memberCount
// @property {string} createdBy               the creator is the league's admin (ylläpitäjä)
// @property {boolean} iAmMember
//
// @typedef {Object} LeagueDetail
// @property {string} id  ...all LeagueSummary fields
// @property {boolean} canManage              creator or Krossi moderator (admin / the city's admin)
// @property {PersonLite} organizer           the creator (ylläpitäjä)
// @property {{roundNumber:number, startsOn:string, endsOn:string, status:'planned'|'active'|'completed'}[]} rounds   dates 'YYYY-MM-DD'
// @property {(PersonLite & {groupNumber:number|null, continues:boolean})[]} members   groupNumber = group in the current round
// @property {{id:string, roundNumber:number, groupNumber:number, playerA:PersonLite, playerB:PersonLite,
//             result:null|{sets:{a:number,b:number}[], winnerId:string|null, reportedBy:string, confirmedBy:string|null,
//                          confirmedAt:string|null, walkover:boolean, setByAdmin:boolean}}[]} fixtures
//   winnerId null = draw (timed only). setByAdmin: entered/accepted by the league admin.
//
// @typedef {Object} LeagueInput
// @property {string} city
// @property {SkillLevel|'kaikki'} skillLevel
// @property {string} seasonLabel
// @property {'ladder'|'hallisarja'} [format]
// @property {'sets'|'timed'} [matchFormat]
// @property {number} [groupSize]
// @property {string} [description]
// @property {string} [venue]
// @property {{startsOn:string, endsOn:string}[]} [rounds]   hallisarja: planned rounds
// @property {boolean} [organizerPlays]      hallisarja: does the creator play too (ladder: always)
// @property {boolean} [isPublic]
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
//
// ── Court booking (kenttävaraus) ─────────────────────────────────────────────
// A venue (hall operator, e.g. Lahden Tennis- ja Squashkeskus) has locations (Janus-Areena,
// Kispi-Areena, Kisapuisto outdoor courts) and each location has courts. Times are the venue's
// local time (Europe/Helsinki); every ISO string is a real instant. Prices are cents.
//
// @typedef {'tennis'|'padel'|'sulkapallo'|'squash'} BookingSport
//
// @typedef {Object} BookingCourt
// @property {string} id
// @property {string} locationId
// @property {string} name                    'Tennis 1'
// @property {string} shortName               'Te1' — compact label for lists and the calendar
// @property {BookingSport} sport
// @property {string|null} surface            'massa' | 'kova' | 'matto' | 'parketti' | …
// @property {string|null} mapId              where the court is on its location's floor map
//                                            (screens/booking/venueMaps.js), e.g. 'te1', 'sulka3'
//
// @typedef {Object} BookingLocation
// @property {string} id
// @property {string} name                    'Janus-Areena'
// @property {string|null} address            'Heinlammintie 64, Lahti'
// @property {boolean} indoor
// @property {string|null} mapKey             'lahti-janus' | 'lahti-kispi' | 'lahti-kisapuisto' | null (no map)
// @property {number|null} lat                for directions and the weather of outdoor courts
// @property {number|null} lng
// @property {BookingCourt[]} courts          sorted for display
//
// @typedef {Object} BookingPriceRule          highest priority first; the first rule that matches
//                                            a 30-minute piece prices it. A piece no rule matches
//                                            can't be booked (rules double as opening hours).
// @property {BookingSport[]|null} sports      null = every sport
// @property {string[]|null} courtIds          null = every court
// @property {number[]} weekdays               ISO weekdays, 1 = ma … 7 = su
// @property {string} from                     'HH:MM' local, inclusive
// @property {string} until                    'HH:MM' local, exclusive ('24:00' = midnight)
// @property {number} centsPerHour
//
// @typedef {Object} BookingVenue
// @property {string} id
// @property {string} slug                     URL name: /pelaa/varaa/<slug>
// @property {string} name
// @property {string} city
// @property {string} openFrom                 'HH:MM' earliest start shown in the calendar
// @property {string} openUntil                'HH:MM' latest end shown in the calendar
// @property {number} slotMinutes              start times are on this grid (30)
// @property {number[]} durations              bookable lengths in minutes, e.g. [60, 90, 120]
// @property {number} daysAhead                how many days ahead can be booked (today = day 0)
// @property {number} cancelLimitHours         free cancellation until this long before the start
// @property {number} shareDeadlineHours       jaettu maksu: friends pay their shares until this long before the
//                                            start; then the unpaid shares are charged to the booker's saved card
// @property {number} holdMinutes              an unpaid booking holds the court this long
// @property {boolean} payOnline               true = Stripe checkout (the only mode for now)
// @property {{hours:number, percent:number}|null} lastMinute   "viime hetken ale": a booking made
//                                            less than `hours` before its start costs `percent` % less
//                                            (the server applies it in krossi_hold_booking)
// @property {boolean} isStaff                 the signed-in user may open the hall view
// @property {BookingLocation[]} locations
// @property {BookingPriceRule[]} prices
//
// @typedef {Object} BookingBusy               what the public calendar knows about a taken slot
// @property {string} id
// @property {string} courtId
// @property {string} startsAt
// @property {string} endsAt
// @property {'booking'|'block'|'league'} kind  league = reserved for a hallisarja / league round
// @property {boolean} mine                    my own booking (held or confirmed)
// @property {string|null} title               blocks only, e.g. 'Hallisarja', 'Valmennus' (never a name)
// @property {boolean} forSale                 "Laita myyntiin": its booker sells it on. A booking that covers the
//                                            whole slot takes it over (features/booking.js blockingAt); the seller
//                                            then gets everything back. Never mine to buy.
//
// @typedef {Object} Booking                   one of my bookings
// @property {string} id
// @property {string} venueId
// @property {string} venueName
// @property {string} locationName
// @property {string|null} mapKey
// @property {string} courtId
// @property {string} courtName
// @property {string|null} courtMapId
// @property {BookingSport} sport
// @property {string} startsAt
// @property {string} endsAt
// @property {'held'|'confirmed'|'cancelled'|'expired'} status
// @property {number} priceCents
// @property {'unpaid'|'paid'|'refunded'|'free'} paymentStatus
// @property {string|null} holdExpiresAt       while status = 'held'
// @property {string} cancellableUntil         startsAt − venue.cancelLimitHours
// @property {string|null} cancelledAt
// @property {string} createdAt
// @property {boolean} forSale                 on sale ("Laita myyntiin"): others see the slot as bookable, and it
//                                            stays mine until somebody books it
// @property {string|null} soldAt              somebody booked it while it was on sale: status 'cancelled', and
//                                            everything paid for it went back (paymentStatus 'refunded')
// @property {BookingSplit|null} split         jaettu maksu with pelikaverit; null = the booker pays it all
//
// @typedef {Object} BookingSplit
// @property {2|4} parts                       kaksinpeli 2 / nelinpeli 4 payers, the booker included
// @property {number} ownCents                 the booker's part (paid when booking; an uneven split's extra cents)
// @property {string} deadline                 friends pay until startsAt − venue.shareDeadlineHours; then the
//                                            unpaid shares become the booker's 'rest' share, charged to the saved card
// @property {BookingShareLine[]} lines        the booker ('own') first, then the friends, then 'rest' if any
//
// @typedef {Object} BookingShareLine          one payer of a split booking
// @property {string|null} id                  share id (null for the booker's own part)
// @property {'own'|'friend'|'rest'} kind      rest = the unpaid friend shares, owed by the booker after the deadline
// @property {PersonLite} person
// @property {number} cents
// @property {'pending'|'paid'|'declined'|'covered'|'refunded'|'cancelled'} status
//                                            declined = "en pääse" (still owed); covered = the rest share took it over
// @property {string|null} paidAt
//
// @typedef {Object} BookingShare              a share I owe: a friend's booking ("Maksa osuutesi") or the rest of my own
// @property {string} id
// @property {'friend'|'rest'} kind
// @property {number} cents
// @property {'pending'|'paid'|'declined'|'covered'|'refunded'|'cancelled'} status
// @property {string|null} paidAt
// @property {string} deadline                 = booking.split.deadline
// @property {boolean} payable                 pending/declined while the booking is on (a friend share only until
//                                            the deadline; a rest share until it is paid)
// @property {string|null} chargeError         rest only: why the saved card was not charged ('card_declined', …)
// @property {PersonLite} booker
// @property {Booking} booking                 the booking with its split (everybody's lines)
//
// @typedef {Object} BookingWatch              "Ilmoita kun vapautuu": tell me when a court frees up
// @property {string} id
// @property {string} venueId
// @property {BookingSport} sport
// @property {string|null} locationId          null = any of the venue's places
// @property {string} startsAt
// @property {number} minutes
// @property {string|null} notifiedAt          set when a court freed up and I was told (email + in app)
// @property {string} createdAt
//
// @typedef {Object} StaffItem                 the hall view: everything on one day, with names
// @property {string} id
// @property {string} courtId
// @property {string} startsAt
// @property {string} endsAt
// @property {'booking'|'block'|'league'} kind
// @property {'held'|'confirmed'} status
// @property {string|null} title               blocks: their title; bookings: null
// @property {PersonLite|null} bookedBy        bookings only
// @property {number} priceCents
// @property {'unpaid'|'paid'|'refunded'|'free'|'none'} paymentStatus   'none' = a block (nothing to pay); the
//                                            booker's own part for a split booking
// @property {boolean} forSale                 the booker has put it on sale
// @property {number} unpaidCents              split bookings: friend shares not paid yet + an unpaid rest share
//                                            (the counter can collect a rest the card did not cover)
// @property {number|null} parts               split bookings: 2 or 4 payers

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
    'publicGet',           // (id) -> LeagueDetail|null   works without a session; only leagues marked public, names "Etunimi S."
    'create',              // (LeagueInput) -> id
    'update',              // (id, { seasonLabel, description, venue, isPublic }) -> void   (admin)
    'remove',              // (id) -> void   (admin or moderator; deletes everything)
    'finish',              // (id) -> void   (admin; ends the season)
    'join',                // (id) -> void   (hallisarja: also mid-season, group from the next round)
    'leave',               // (id) -> void   (sign-up, or a hallisarja between rounds)
    'setContinues',        // (id, boolean) -> void   hallisarja: "jatkan seuraavalla kierroksella"
    'removeMember',        // (id, userId) -> void   (admin; not from a group of a running round)
    'start',               // (id) -> void   (ladder, creator only, needs >= 4 members)
    'startRound',          // (id, groups:string[][], { startsOn, endsOn }) -> roundNumber   (admin, hallisarja; groups top first)
    'closeRound',          // (id) -> void   (admin, hallisarja; unconfirmed reports are accepted as reported)
    'reportResult',        // (fixtureId, sets:{a,b}[], winnerId|null) -> void   timed: one row of games, winner derived
    'confirmResult',       // (fixtureId) -> void
    'adminSetResult',      // (fixtureId, { sets:{a,b}[]|null, winnerId:string|null, walkover:boolean }) -> void   (admin; confirmed at once)
    'adminConfirmResult',  // (fixtureId) -> void   (admin)
    'adminClearResult',    // (fixtureId) -> void   (admin)
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
    'startCheckout',       // () -> void   redirects to Stripe's hosted Checkout (fallback)
    'checkoutConfig',      // () -> { paid: true } | { hosted: true } | { publishableKey, amount, currency, email }
    'createPaymentIntent', // () -> { paid: true } | { clientSecret, paymentIntentId }   reuses an unfinished one
    'verifyPayment',       // (paymentIntentId) -> { paid, status }   checks Stripe, unlocks the profile if paid
    'adminSetOwnPaid',     // (paid:boolean) -> void   admins only
  ],
  booking: [
    'listVenues',          // () -> BookingVenue[]   works without a session (isStaff false then)
    'getVenue',            // (idOrSlug) -> BookingVenue|null   works without a session
    'day',                 // (venueId, 'YYYY-MM-DD') -> { date, busy: BookingBusy[] }   held + confirmed bookings and blocks; works without a session
    'hold',                // ({ courtId, startsAt, minutes, friendIds? }) -> Booking   status 'held' for venue.holdMinutes; the server prices it ('Joku ehti ensin…' if taken).
                           //   A booking covering on-sale bookings takes them over (no last-minute deal then).
                           //   friendIds (1 = kaksinpeli, 3 = nelinpeli, from shareFriends): jaettu maksu — split.ownCents is paid now
    'release',             // (bookingId) -> void   drops my own unpaid hold (backing out before paying)
    'checkoutConfig',      // (bookingId) -> { paid: true } | { demo: true, amount, currency } | { publishableKey, amount, currency, email, setupFutureUsage }
                           //   amount = what I pay now (split: ownCents); setupFutureUsage 'off_session' (split) = the card is saved for the rest, else null
    'createPaymentIntent', // (bookingId) -> { paid: true } | { clientSecret, paymentIntentId }
    'verifyPayment',       // (bookingId, paymentIntentId) -> { confirmed: boolean, status }   confirms the booking once Stripe says succeeded (split: then the friends are asked)
    'listMine',            // () -> { upcoming: Booking[], past: Booking[] }   upcoming = held|confirmed, not ended, soonest first; past = newest first, max 30
    'cancel',              // (bookingId) -> { refundedCents }   only before cancellableUntil; refunds every paid part (friends' shares too) to its payment method
    'putOnSale',           // (bookingId) -> Booking   "Laita myyntiin": my confirmed booking after cancellableUntil, before the start ('Voit vielä perua…' before the limit).
                           //   Others can book the slot; when somebody does, everything paid is refunded and I'm told. Watchers of the time are told at once.
    'takeOffSale',         // (bookingId) -> Booking   back to just mine ('Joku on juuri varaamassa…' while a buyer is paying)
    'shareFriends',        // () -> PersonLite[]   who I can split a booking with: pelikaverit and chat contacts (Krossi players, no blocks), most recent first
    'listShares',          // () -> BookingShare[]   shares I owe or owed (friends' bookings, my rest shares): payable first, soonest deadline first; then the last 30 days
    'getShare',            // (shareId) -> BookingShare|null   my share, or any share of my own booking
    'shareCheckoutConfig', // (shareId) -> { paid: true } | { demo: true, amount, currency } | { publishableKey, amount, currency, email, setupFutureUsage: null }   'Maksuaika päättyi…' after a friend share's deadline
    'createSharePaymentIntent', // (shareId) -> { paid: true } | { clientSecret, paymentIntentId }
    'verifySharePayment',  // (shareId, paymentIntentId) -> { paid: boolean, status, message? }   status 'refunded' + message: the share was settled meanwhile and this payment went back
    'declineShare',        // (shareId) -> void   "En pääse": tells the booker in our chat; the share stays owed (the booker's card covers it after the deadline)
    'watch',               // ({ venueId, sport, locationId, startsAt, minutes }) -> BookingWatch   max 5 active; 'Aika on vapaana…' if a court is free already; a duplicate returns the existing one
    'unwatch',             // (watchId) -> void
    'listWatches',         // () -> BookingWatch[]   mine, startsAt still ahead, soonest first
    'staffDay',            // (venueId, 'YYYY-MM-DD') -> StaffItem[]   venue staff only
    'block',               // ({ courtIds, startsAt, endsAt, title, kind: 'block'|'league' }) -> string[]   staff only; fails if anything overlaps
    'unblock',             // (blockId) -> void   staff only
    'staffCancel',         // (bookingId, { refund: boolean }) -> void   staff only; refund = money back to everybody who paid
  ],
  admin: [
    'stats',               // () -> object (krossi_admin_stats jsonb as-is)
    'users',               // () -> AdminUser[]
    'deleteUser',          // (userId) -> void
    'setCityAdmin',        // (userId, cities[]) -> void
  ],
};
