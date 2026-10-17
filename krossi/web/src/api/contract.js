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
// @typedef {Object} MatchResult             always from MY point of view ("my" = my side), whoever logged it
// @property {string} id
// @property {string} createdAt
// @property {'sets'|'tiebreak'|'full_match'} gameType
// @property {'singles'|'doubles'} format
// @property {string|null} partnerName       names as shown: typed, or the linked player's name
// @property {string|null} opponentName
// @property {string|null} oppPartnerName
// @property {{my:number, opp:number}[]} sets
// @property {boolean} won
// @property {PersonLite|null} partner       linked Krossi players (null = typed name only)
// @property {PersonLite|null} opponent
// @property {PersonLite|null} oppPartner
// @property {null|'pending'|'confirmed'|'disputed'} confirmation   null = no Krossi player on the other side, nothing to confirm
// @property {PersonLite|null} answeredBy    who on the other side confirmed / disputed
// @property {string|null} answeredAt
// @property {boolean} isMine                 I logged it (others' results are read-only for me)
// @property {PersonLite|null} loggedBy       who logged it, when not me
//
// @typedef {Object} MatchResultInput         what MatchResultSheet saves
// @property {'sets'|'tiebreak'|'full_match'} gameType
// @property {'singles'|'doubles'} format
// @property {string|null} partnerName
// @property {string|null} opponentName
// @property {string|null} oppPartnerName
// @property {string|null} [partnerId]        Krossi players (doubles only for the partners)
// @property {string|null} [opponentId]
// @property {string|null} [oppPartnerId]
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
//   { type:'match_result_logged', resultId, creatorId }   asks the linked opponent(s) to confirm the result
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
// @property {boolean} splitPay                jaettu maksu: the booker pays the whole court, then shares a link and
//                                            friends pay their parts (no account needed); each paid part goes back
//                                            to the booker. false = this server doesn't have it yet (the screens hide it)
// @property {boolean} resale                  "Laita myyntiin" (false = not on this server yet)
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
// @property {'booking'|'block'|'league'|'season'} kind  league = reserved for a hallisarja / league round;
//                                            season = one week of a kausivuoro (SeasonSlot)
// @property {boolean} mine                    my own booking (held or confirmed) or my own season slot
// @property {string|null} title               blocks only, e.g. 'Hallisarja', 'Valmennus'; season rows
//                                            'Kausivuoro' (never a name)
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
// @property {'unpaid'|'paid'|'refunded'|'free'|'credit'} paymentStatus   credit = paid in full with a
//                                            series card or gift card balance (BookingCredit)
// @property {string|null} holdExpiresAt       while status = 'held'
// @property {string} cancellableUntil         startsAt − venue.cancelLimitHours
// @property {string|null} cancelledAt
// @property {string} createdAt
// @property {BookingCredit|null} credit       the part paid (or, on a hold, to be paid) with credit
// @property {boolean} forSale                 on sale ("Laita myyntiin"): others see the slot as bookable, and it
//                                            stays mine until somebody books it
// @property {string|null} soldAt              somebody booked it while it was on sale: status 'cancelled', and
//                                            everything paid for it went back (paymentStatus 'refunded')
// @property {BookingSplit|null} split         jaettu maksu: friends pay their parts by link; null = not split
//
// @typedef {Object} BookingCredit             sarjakortti / lahjakortti on a booking
// @property {'pass'|'gift'} kind
// @property {number} cents                    the price this credit covers (a pass covers it all; gift
//                                            balance may cover part — the rest is paid by card,
//                                            priceCents − cents)
// @property {number} minutes                  pass: minutes taken from the series card; gift: 0
// @property {string|null} name                pass: its name ('Tennis 10 × 1 h'); gift: null
//
// @typedef {Object} BookingSplit              jaettu maksu: the booker paid it all; friends pay their parts by link
// @property {2|4} parts                       kaksinpeli 2 / nelinpeli 4 payers, the booker included
// @property {number} perCents                 what one friend pays: floor(priceCents / parts)
// @property {number} ownCents                 the booker's own part: priceCents − (parts − 1) × perCents
// @property {string|null} token               the link's secret (/pelaa/maksa/<token>): only the booker sees it
// @property {BookingShareLine[]} lines        the booker ('own') first, then one line per friend part
//
// @typedef {Object} BookingShareLine          one payer of a split booking
// @property {string|null} id                  share id (null for the booker's own part)
// @property {'own'|'friend'} kind
// @property {PersonLite|null} person          the booker; a friend who paid signed in
// @property {string|null} name                a friend who paid without an account: the name they gave (or null)
// @property {number} cents
// @property {'open'|'pending'|'paid'|'refunded'} status   own: always 'paid' (refunded when the booking was).
//                                            friend: open = nobody has paid it; pending = somebody is paying it
//                                            right now (15 min claim); paid = paid, and the same sum went back to
//                                            the booker; refunded = the booking was cancelled or sold after it was paid
// @property {string|null} paidAt
//
// @typedef {Object} PublicSplit               what the payment link shows — no account needed
// @property {string} token
// @property {string} venueName
// @property {string} locationName
// @property {string} courtName
// @property {BookingSport} sport
// @property {string} startsAt
// @property {string} endsAt
// @property {string} bookerFirstName
// @property {string|null} bookerAvatarUrl
// @property {2|4} parts
// @property {number} perCents
// @property {number} paidCount                friend parts paid
// @property {number} openCount                friend parts nobody is paying (pending ones don't count)
// @property {'open'|'full'|'over'|'cancelled'} state   full = every part paid or being paid; over = the time
//                                            has started; cancelled = the booking was cancelled or sold on
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
// @property {'booking'|'block'|'league'|'season'} kind
// @property {'held'|'confirmed'} status
// @property {string|null} title               blocks: their title; season: the holder's name or team;
//                                            bookings: null
// @property {PersonLite|null} bookedBy        bookings, and season rows of a Krossi player
// @property {number} priceCents               season rows: the week's share of the season price
// @property {'unpaid'|'paid'|'refunded'|'free'|'credit'|'none'} paymentStatus   'none' = a block or a
//                                            season row (the season is billed on its own)
// @property {string|null} seasonSlotId        season rows only
// @property {BookingCredit|null} credit
// @property {boolean} forSale                 the booker has put it on sale
//
// ── Kausivuorot, laskutus, sarja- ja lahjakortit ─────────────────────────────
// A venue runs seasons ("Talvikausi 2026–2027"). A kausivuoro (SeasonSlot) is the same court,
// weekday and time every week of a season, minus the season's holidays and any dates skipped
// because the court was taken. Its weeks are real reservation rows (kind 'season'), so the
// double-booking guard covers them. Season price = for each month, the normal prices of that
// month's weeks minus the season discount, rounded to cents; the season = the sum of the months.
// A season slot is paid by invoice (lasku) or charged month by month from the holder's saved card.
//
// @typedef {Object} Season
// @property {string} id
// @property {string} venueId
// @property {string} name                     'Talvikausi 2026–2027'
// @property {string} startsOn                 'YYYY-MM-DD'
// @property {string} endsOn                   'YYYY-MM-DD' (last day of play)
// @property {string[]} skipDates              holidays without season play ('YYYY-MM-DD')
// @property {number} discountPercent          the season rate: normal prices minus this percent
// @property {boolean} requestsOpen            players may apply for a season slot
//
// @typedef {Object} SeasonWeek                one week of a quote
// @property {string} date                     'YYYY-MM-DD'
// @property {string} startsAt
// @property {string} endsAt
// @property {number|null} cents               normal price (null = the court is closed then)
// @property {null|{kind:'booking'|'block'|'league'|'season'|'closed', title:string|null}} conflict
//
// @typedef {Object} SeasonQuote
// @property {string} seasonId
// @property {string|null} courtId             the court quoted: the one asked for, else the one with
//                                            the fewest conflicts (venue order on a tie)
// @property {number} weekday                  ISO 1 = ma … 7 = su
// @property {string} startTime                'HH:MM' local
// @property {number} minutes
// @property {SeasonWeek[]} weeks              every remaining week of the season on that weekday
// @property {string[]} skipped                the season's holidays on that weekday
// @property {number} count                    weeks without a conflict (what would be booked)
// @property {number} fullCents                Σ normal prices of those weeks
// @property {number} discountPercent
// @property {number} cents                    season price (Σ months)
// @property {{month:string, count:number, cents:number}[]} months   'YYYY-MM': monthly card charges
// @property {{courtId:string, conflicts:number}[]} courts   every court of the sport at the location (the
//                                            asked court's, the given one, or all), venue order, with conflicts
//
// @typedef {Object} SeasonSlot                kausivuoro
// @property {string} id
// @property {string} venueId
// @property {string} seasonId
// @property {string} seasonName
// @property {BookingSport} sport
// @property {string|null} courtId             null = a request for any free court (staff pick one)
// @property {string|null} courtName
// @property {string|null} locationId
// @property {string} locationName             '' when the request named no place
// @property {number} weekday                  ISO 1–7
// @property {string} startTime                'HH:MM'
// @property {number} minutes
// @property {string} startsOn                 first week 'YYYY-MM-DD'
// @property {string} endsOn                   last day of the season
// @property {string[]} skipDates              holidays + weeks skipped because the court was taken
// @property {'requested'|'active'|'declined'|'withdrawn'|'ended'} status
// @property {'invoice'|'card'} billing
// @property {number} priceCents               season price (a quote while requested)
// @property {number} weeks                    how many times (a quote while requested)
// @property {string} holderName               the player's name, or a team the hall added
// @property {PersonLite|null} holder          the Krossi player (null = added by the hall)
// @property {string|null} billingEmail        invoices go here
// @property {string|null} billingAddress
// @property {string|null} note                the player's message with the request
// @property {string|null} declineReason
// @property {string|null} nextAt              next week's start (active only)
// @property {{id:string, number:string, dueOn:string, amountCents:number, status:'open'|'paid'|'void'}|null} invoice
// @property {CardCharge[]} charges            billing 'card': the month-by-month schedule
// @property {string} createdAt
// @property {string|null} decidedAt           approved / declined / ended
// @property {string|null} notifiedAt          when the player was e-mailed the hall's decision on their
//                                            request (approved or declined); null = not (yet), or a slot
//                                            the hall added itself
//
// @typedef {Object} CardCharge                one month of a card-billed season slot
// @property {string} id
// @property {string} seasonSlotId
// @property {string} month                    'YYYY-MM'
// @property {number} weeks
// @property {number} amountCents
// @property {string} dueOn                    'YYYY-MM-DD' (the 1st; the first month: the approval day)
// @property {'scheduled'|'processing'|'paid'|'failed'|'void'} status
// @property {number} attempts
// @property {string|null} failureMessage      Finnish, for the player and the hall
// @property {string|null} paidAt
// @property {string} holderName
//
// @typedef {Object} InvoiceLine
// @property {string} text
// @property {number} quantity
// @property {string} unit                     'krt', or '' on a discount line
// @property {number|null} unitCents
// @property {number} totalCents               VAT included (negative for a discount)
//
// @typedef {Object} Invoice                   lasku (prices include VAT)
// @property {string} id
// @property {string} venueId
// @property {string} seasonSlotId
// @property {string} number                   '1001'
// @property {string} reference                Finnish reference number (viitenumero) '10016'
// @property {string} issuedOn                 'YYYY-MM-DD'
// @property {string} dueOn
// @property {number} amountCents
// @property {number} vatPercent
// @property {number} vatCents                 the VAT inside amountCents
// @property {InvoiceLine[]} lines
// @property {{name:string, email:string|null, address:string|null}} recipient
// @property {{name:string, businessId:string|null, address:string|null, iban:string|null, bic:string|null,
//             email:string|null, phone:string|null}} seller        the hall's invoicing details
// @property {'open'|'paid'|'void'} status      overdue = open after dueOn (the UI says so)
// @property {string|null} paidOn
// @property {string|null} sentAt
// @property {string} createdAt
//
// @typedef {Object} SavedCard                 the card monthly season charges are taken from
// @property {string} brand                    'visa' | 'mastercard' | …
// @property {string} last4
// @property {number} expMonth
// @property {number} expYear
//
// @typedef {Object} PassProduct               sarjakortti the hall sells
// @property {string} id
// @property {string} venueId
// @property {string} name                     'Tennis 10 × 1 h'
// @property {BookingSport} sport
// @property {number} uses                     10
// @property {number} minutesPerUse            60 — the card holds uses × minutesPerUse minutes
// @property {number} validDays                from the purchase
// @property {number} priceCents
// @property {string|null} description
//
// @typedef {Object} CreditEvent               a line of a series card's or the gift balance's history
// @property {string} id
// @property {'purchase'|'use'|'refund'|'redeem'|'adjust'} kind
// @property {number} minutes                  series card: + bought / refunded, − used
// @property {number} cents                    gift balance: + redeemed / refunded, − used
// @property {string} label                    'Tennis 2 · Janus-Areena · ti 6.10. klo 19.00'
// @property {string|null} bookingId
// @property {string} createdAt
//
// @typedef {Object} Pass                      a series card of mine
// @property {string} id
// @property {string} venueId
// @property {string} productId
// @property {string} name
// @property {BookingSport} sport
// @property {number} minutesTotal
// @property {number} minutesLeft
// @property {string|null} validUntil          'YYYY-MM-DD': bookings up to this day (null until paid)
// @property {'pending'|'active'|'used'|'expired'} status   pending = not paid yet
// @property {number} priceCents
// @property {string|null} purchasedAt
// @property {CreditEvent[]} history           newest first
//
// @typedef {Object} GiftCard                  lahjakortti
// @property {string} id
// @property {string} venueId
// @property {string|null} code                'KRSI-7F3K-9QPA', once paid (the buyer passes it on)
// @property {number} amountCents
// @property {string|null} recipientName
// @property {string|null} message
// @property {'pending'|'active'|'redeemed'|'expired'} status
// @property {string|null} validUntil          redeem by this day
// @property {string|null} redeemedAt
// @property {string} createdAt
//
// @typedef {Object} Wallet                    my credit at one venue
// @property {string} venueId
// @property {Pass[]} passes                   active first (soonest to expire), then used up / expired
// @property {number} giftCents                gift balance I can spend now
// @property {CreditEvent[]} giftHistory       newest first
// @property {GiftCard[]} giftCards             gift cards I bought (paid ones), newest first
//
// ── Hallin asetukset (the hall's own settings) ───────────────────────────────
// Staff edit the venue's seasons, series card products, gift card limits and invoicing details in
// the app (/pelaa/halli/:venue?nakyma=asetukset). The checks and their Finnish messages are
// features/seasons.js's checkSeason / checkPassProduct / checkGiftSettings / checkBillingSettings;
// the RPCs check the same again. Changes apply to new requests, approvals, orders and invoices:
// an active kausivuoro keeps its weeks and price, a paid series card its content, an invoice its
// seller details.
//
// @typedef {Object} SeasonInput               seasons.saveSeason
// @property {string|null} id                  null = a new season
// @property {string} venueId
// @property {string} name
// @property {string} startsOn                 'YYYY-MM-DD'
// @property {string} endsOn
// @property {string[]} skipDates              holidays; days outside startsOn…endsOn are dropped
// @property {number} discountPercent          whole percent 0–90
// @property {boolean} requestsOpen
//
// @typedef {Object} StaffSeason               Season + what the settings view needs
// @property {string} id  ...all Season fields
// @property {number} activeSlots              kausivuoroja voimassa
// @property {number} requests                 requests waiting for the hall
// @property {string|null} bookedFrom          first and last week ('YYYY-MM-DD') of its active slots: the
// @property {string|null} bookedUntil         season's dates must keep covering them (null = none)
// @property {boolean} removable               no kausivuoro or request of any kind refers to it
//
// @typedef {Object} StaffPassProduct          PassProduct + the hall's own fields
// @property {string} id  ...all PassProduct fields
// @property {boolean} active                  for sale (wallet.products lists only these)
// @property {number} sold                     paid series cards of this product
// @property {boolean} removable               never ordered (else: hide it, active false)
//
// @typedef {Object} PassProductInput          wallet.saveProduct
// @property {string|null} id                  null = a new product
// @property {string} venueId
// @property {string} name
// @property {BookingSport} sport              a sport the venue has courts for
// @property {number} uses                     1–200
// @property {number} minutesPerUse            30–480 in half hours
// @property {number} validDays                1–1825, from the purchase
// @property {number} priceCents               50–1 000 000
// @property {string|null} description         ≤ 300 characters
// @property {boolean} active
//
// @typedef {Object} GiftSettings              the venue's gift cards (wallet.products' `gift`)
// @property {number[]} amounts                ready amounts in cents, whole euros, ascending (1–6 of them)
// @property {number} minCents                 smallest amount of one's own (whole euros, ≥ 1 €)
// @property {number} maxCents                 largest (≤ 1000 €); the ready amounts are between the two
// @property {number} validDays                30–1825, from the purchase
//
// @typedef {Object} BillingSettings           laskutustiedot: what an invoice says about the seller
// @property {string} venueId
// @property {string} sellerName               '' until filled
// @property {string|null} businessId          Y-tunnus '1234567-1'
// @property {string|null} address
// @property {string|null} iban                'FI2112345600000785' (no spaces)
// @property {string|null} bic
// @property {string|null} email               also the reply-to of invoices and decision e-mails
// @property {string|null} phone
// @property {number} vatPercent               ALV % in the prices, one decimal (25.5)
// @property {number} paymentTermsDays         due date = invoice day + this
// @property {number} nextInvoiceNumber        the next invoice's number
// @property {number} lastInvoiceNumber        the biggest number used so far (0 = none)
// @property {boolean} ready                   seller name and IBAN filled: invoiced slots can be approved
// @property {string|null} updatedAt
//
// @typedef {Object} PayoutStatus              billing.payoutStatus: the hall's own Stripe account (Stripe Connect Express)
// @property {'none'|'pending'|'ready'} state   none = no account; pending = Stripe still needs details or checks them;
//                                              ready = players' payments go to the hall's account
// @property {boolean} chargesEnabled
// @property {boolean} payoutsEnabled
// @property {boolean} detailsSubmitted         the hall has gone through Stripe's form (its dashboard opens)
// @property {number} dueCount                 details Stripe still needs
// @property {boolean} canConnect               the caller may connect / continue the account (Krossi's admins)
// @property {{ stripeBps: number, stripeFixedCents: number, marginBps: number, marginFixedCents: number }} fee
//                                              Krossi's share of a payment: ceil(amount × (stripeBps + marginBps) / 10 000)
//                                              + stripeFixedCents + marginFixedCents (features/payouts.js paymentFee)
//
// @typedef {Object} BillingSettingsInput      billing.saveSettings: the BillingSettings fields staff edit
// @property {string} sellerName
// @property {string|null} businessId          check digit checked; '12345671' / 'FI12345671' are fine too
// @property {string|null} address
// @property {string|null} iban                mod 97 checked; spaces are fine
// @property {string|null} bic                 a Finnish IBAN needs a Finnish bank's BIC
// @property {string|null} email
// @property {string|null} phone
// @property {number} vatPercent
// @property {number} paymentTermsDays         0–90
// @property {number|null} nextInvoiceNumber   above lastInvoiceNumber; null keeps the current one

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
    'listMine',            // () -> MatchResult[]   newest first, max 100: mine, and others' with me in them once confirmed (isMine false)
    'save',                // (id|null, MatchResultInput) -> { id, confirmation }   a linked opponent makes it 'pending' and is asked
                           //   (emits match_result_logged; again when I change the score or players of an answered result)
    'remove',              // (id) -> void   only my own
    'candidates',          // ({ city }) -> { partners: Partner[], players: Profile[] }   who I can name as a Krossi player (paid profile access)
    'listToConfirm',       // () -> MatchResult[]   others' results with me on the other side, waiting for my answer (isMine false)
    'confirm',             // (id) -> void   "Vahvista" (an answer can be changed later)
    'dispute',             // (id) -> void   "Ei pidä paikkaansa": the logger sees it and can correct the result
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
    'hold',                // ({ courtId, startsAt, minutes }) -> Booking   status 'held' for venue.holdMinutes; the server prices it ('Joku ehti ensin…' if taken).
                           //   A booking covering on-sale bookings takes them over (no last-minute deal then). The sheet holds only when the player pays.
    'release',             // (bookingId) -> void   drops my own unpaid hold (backing out before paying)
    'payConfig',           // () -> { demo: true } | { publishableKey, currency, email } | { legacy: true }   what the booking sheet needs to show the
                           //   payment methods before anything is held; legacy = this server only knows checkoutConfig(bookingId) (hold first)
    'checkoutConfig',      // (bookingId) -> { paid: true } | { demo: true, amount, currency } | { publishableKey, amount, currency, email }   amount = the whole price minus credit
    'createPaymentIntent', // (bookingId) -> { paid: true } | { clientSecret, paymentIntentId }
    'verifyPayment',       // (bookingId, paymentIntentId) -> { confirmed: boolean, status }   confirms the booking once Stripe says succeeded
    'listMine',            // () -> { upcoming: Booking[], past: Booking[] }   upcoming = held|confirmed, not ended, soonest first; past = newest first, max 30
    'cancel',              // (bookingId) -> { refundedCents, feeCents, creditCents, creditMinutes }   only before cancellableUntil; money back to the original payment method minus the
                           //   1 € peruutuskulu (feeCents; friends' paid parts whole to theirs), credit back to the series card / gift balance
    'putOnSale',           // (bookingId) -> Booking   "Laita myyntiin": my confirmed booking after cancellableUntil, before the start ('Voit vielä perua…' before the limit).
                           //   Others can book the slot; when somebody does, everything paid is refunded and I'm told. Watchers of the time are told at once.
    'takeOffSale',         // (bookingId) -> Booking   back to just mine ('Joku on juuri varaamassa…' while a buyer is paying)
    'split',               // (bookingId, parts: 1|2|4) -> Booking   jaettu maksu on my paid booking (not credit, not on sale, not started): parts − 1
                           //   friend parts and a link token; parts can change, and 1 removes the split, while no part is paid or being paid
    'splitPublic',         // (token) -> PublicSplit|null   what the link shows; works without a session
    'splitCheckoutConfig', // (token) -> { full: true } | { over: true } | { demo: true, amount, currency } | { publishableKey, amount, currency }   works without a session
    'createSplitPaymentIntent', // (token, { name }) -> { paid: true } | { full: true } | { clientSecret, paymentIntentId }   claims one open part for
                           //   15 min; name (≤ 40 chars, optional) shows to the booker — signed in, the profile's name. The demo pays at once.
    'verifySplitPayment',  // (token, paymentIntentId) -> { paid: boolean, status, message? }   paid: the same sum goes back to the booker;
                           //   status 'refunded' + message: the booking was cancelled or sold meanwhile and this payment went back
    'watch',               // ({ venueId, sport, locationId, startsAt, minutes }) -> BookingWatch   max 5 active; 'Aika on vapaana…' if a court is free already; a duplicate returns the existing one
    'unwatch',             // (watchId) -> void
    'listWatches',         // () -> BookingWatch[]   mine, startsAt still ahead, soonest first
    'staffDay',            // (venueId, 'YYYY-MM-DD') -> StaffItem[]   venue staff only
    'block',               // ({ courtIds, startsAt, endsAt, title, kind: 'block'|'league' }) -> string[]   staff only; fails if anything overlaps
    'unblock',             // (blockId) -> void   staff only
    'staffCancel',         // (bookingId, { refund: boolean }) -> void   staff only; refund = money back to everybody who paid (the booker and friends)
  ],
  seasons: [
    'list',                // (venueId) -> Season[]   seasons not over yet, soonest first; works without a session
    'quote',               // ({ seasonId, courtId, locationId, weekday, startTime, minutes, fromDate }) -> SeasonQuote   courtId/locationId/fromDate may be null
    'request',             // ({ seasonId, courtId, locationId, weekday, startTime, minutes, billing, note }) -> SeasonSlot   'requested'; billing 'card' needs a saved card
    'listMine',            // () -> SeasonSlot[]   requests first, then active by next week, then the rest
    'withdraw',            // (slotId) -> void   my own request while it is 'requested'
    'staffList',           // (venueId) -> SeasonSlot[]   staff only: requests (oldest first), active, the rest
    'create',              // ({ venueId, seasonId, courtId, weekday, startTime, minutes, holderName, billingEmail, billingAddress, priceCents, skipConflicts, fromDate }) -> SeasonSlot   staff: a team's slot, invoiced, active at once
    'approve',             // (slotId, { courtId, priceCents, skipConflicts }) -> SeasonSlot   staff: the weeks go into the calendar and the invoice / card schedule is made; 'conflict' error lists taken weeks unless skipConflicts; the player gets an e-mail (notifiedAt)
    'decline',             // (slotId, reason) -> void   staff; the player gets an e-mail with the reason
    'end',                 // (slotId) -> { released:number }   staff: frees the coming weeks; unpaid card months not due yet are voided
    'releaseOccurrence',   // (reservationId) -> void   staff: frees one week (e.g. a hall event); no money moves
    'staffSeasons',        // (venueId) -> StaffSeason[]   staff: every season of the venue, earliest first (past ones too)
    'saveSeason',          // (SeasonInput) -> StaffSeason   staff: a new season (id null) or changes to one; refused if the dates would leave out weeks of its active slots
    'removeSeason',        // (seasonId) -> void   staff: only a season no kausivuoro or request refers to (else close its requests)
  ],
  billing: [
    'listInvoices',        // (venueId) -> Invoice[]   staff: newest first
    'getInvoice',          // (invoiceId) -> Invoice|null   the venue's staff or the season slot's holder
    'markInvoicePaid',     // (invoiceId, paidOn 'YYYY-MM-DD') -> Invoice   staff
    'sendInvoice',         // (invoiceId) -> { sentTo: string }   staff: emails it to the billing address
    'cardStatus',          // () -> SavedCard|null
    'cardSetup',           // () -> { demo: true } | { publishableKey, clientSecret, email }   Stripe SetupIntent for a card kept on file
    'cardSaved',           // (setupIntentId) -> SavedCard   after Stripe confirmed the setup; the demo takes 'demo-4242' (works) / 'demo-0341' (charges fail)
    'removeCard',          // () -> void   refused while a card-billed season slot is active
    'listCharges',         // (venueId) -> CardCharge[]   staff: failed first, then by due day
    'runCharges',          // (venueId) -> { paid:number, failed:number }   staff (and a daily cron): charges every due month off-session
    'payCharge',           // (chargeId) -> { paid: true } | { demo: true, amount, currency } | { publishableKey, clientSecret, paymentIntentId, amount, currency, email }   my unpaid month, paid in the app
    'verifyCharge',        // (chargeId, paymentIntentId) -> { paid, status }   demo: paymentIntentId null pays it
    'getSettings',         // (venueId) -> BillingSettings   staff
    'saveSettings',        // (venueId, BillingSettingsInput) -> BillingSettings   staff; Y-tunnus, IBAN and BIC are checked, stored normalized
    'payoutStatus',        // (venueId) -> PayoutStatus   staff: the hall's Stripe account and what a payment costs it
    'connectStripe',       // (venueId) -> { url } | { demo: true }   Krossi's admins: Stripe's onboarding page for the hall's account (created on first use)
    'stripeDashboard',     // (venueId) -> { url } | { demo: true }   staff: a one-time login to the hall's Stripe Express dashboard
  ],
  wallet: [
    'products',            // (venueId) -> { passes: PassProduct[], gift: { amounts:number[], minCents, maxCents, validDays }|null }   works without a session; gift null = no gift cards sold
    'get',                 // (venueId) -> Wallet
    'buyPass',             // (productId) -> Pass   'pending' until paid; an unpaid one of the same product is reused
    'buyGiftCard',         // ({ venueId, amountCents, recipientName, message }) -> GiftCard   'pending' until paid
    'checkoutConfig',      // ({ kind: 'pass'|'gift', id }) -> { paid: true } | { demo: true, amount, currency } | { publishableKey, amount, currency, email }
    'createPaymentIntent', // ({ kind, id }) -> { paid: true } | { clientSecret, paymentIntentId }   the demo pays at once
    'verifyPayment',       // ({ kind, id }, paymentIntentId) -> { paid, status }   activates the pass / issues the gift card's code
    'redeem',              // (code) -> { venueId, cents, giftCents }   a gift card's value onto my balance at its venue
    'payBooking',          // (bookingId, passId) -> Booking   pays my held booking with a series card (whole booking); a covered on-sale slot is taken over as on a card payment
    'useGift',             // (bookingId, use:boolean) -> Booking   puts my gift balance on a held booking / takes it off; covering the price confirms it.
                           //   A booking paid (partly) with credit can't be split afterwards.
    'staffList',           // (venueId) -> { passes: (Pass & { owner: PersonLite })[], giftCards: (GiftCard & { buyer: PersonLite|null, redeemedBy: PersonLite|null })[] }   staff, no history
    'staffProducts',       // (venueId) -> { passes: StaffPassProduct[], gift: GiftSettings }   staff: series cards for sale and hidden ones, in shop order
    'saveProduct',         // (PassProductInput) -> StaffPassProduct   staff: new (id null) or changed; unpaid orders of it take the new content and price
    'removeProduct',       // (productId) -> void   staff: only a product never ordered (else hide it)
    'saveGiftSettings',    // (venueId, GiftSettings) -> GiftSettings   staff
  ],
  admin: [
    'stats',               // () -> object (krossi_admin_stats jsonb as-is)
    'users',               // () -> AdminUser[]
    'deleteUser',          // (userId) -> void
    'setCityAdmin',        // (userId, cities[]) -> void
  ],
};
