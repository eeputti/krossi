// krossi-notify — Krossin sähköposti-ilmoitukset (krossi.app/pelaa).
//
// The web app's api.notifications.emit(event) sends the same NotifyEvent body here and to
// send-push-notification, so web and mobile users hear about the same things. Recipients
// are resolved the same way the push function resolves them, but every event is first
// checked against the database (the request must describe something the caller really
// did), because an email endpoint that trusts its body is a spam cannon.
//
// Filters, in order: the caller themself, blocks in either direction, notification
// preferences (email_enabled AND the per-type flag; a missing row means "all on"),
// Krossi player profile (area broadcasts only reach visible players with a
// tennis_preferences row, so Koutsi-only accounts never get Krossi mail), and the
// krossi_email_log throttle:
//   new_message                      one mail per recipient per conversation per 30 min,
//                                    and only while the recipient hasn't read it
//   new_area_challenge/_event        one area mail per recipient per 6 h
//   everything else                  the same event at most once per 10 min
//
// Deploy with verify_jwt = true. The caller's JWT is also checked here (auth.getUser)
// and the event's actor id must be the caller, exactly like send-push-notification.
//
// Required secrets (supabase secrets set ...):
//   RESEND_API_KEY        Resend API key (shared with Koutsi)
// Optional:
//   KROSSI_MAIL_FROM      sender address on a Resend-verified domain
//                         (falls back to KOUTSI_MAIL_FROM, then messages@krossi.app)
//   KROSSI_MAIL_FROM_NAME (default "Krossi")
//
// Response: { sent, skipped } — a failing recipient is counted as skipped, never a 500.
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";

const supabaseUrl = Deno.env.get("SUPABASE_URL");
const publishableKeys = Deno.env.get("SUPABASE_PUBLISHABLE_KEYS");
const secretKeys = Deno.env.get("SUPABASE_SECRET_KEYS");
const supabaseAnonKey = publishableKeys ? JSON.parse(publishableKeys).default : Deno.env.get("SUPABASE_ANON_KEY");
const supabaseServiceRoleKey = secretKeys ? JSON.parse(secretKeys).default : Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceRoleKey) {
  throw new Error("Supabase function environment variables are missing.");
}

const APP_ORIGIN = "https://krossi.app";
const SETTINGS_URL = `${APP_ORIGIN}/pelaa/asetukset`;
const ADMIN_USER_ID = "b65ee88c-efd6-4ea9-b3a2-e2c83f218244";
const RESEND_BATCH_URL = "https://api.resend.com/emails/batch";
const RESEND_SINGLE_URL = "https://api.resend.com/emails";
const RESEND_BATCH_SIZE = 100;
const IN_QUERY_CHUNK = 100;
const EMAIL_LOOKUP_CONCURRENCY = 8;
// A broadcast for a game that was created long ago is a replay, not news.
const AREA_BROADCAST_MAX_AGE_MINUTES = 120;

// ── Event shapes (same as send-push-notification + new_area_event) ──────────

type NotifyEvent =
  | { type: "play_request"; senderId: string; receiverId: string }
  | { type: "new_message"; conversationId: string; senderId: string; hasImage?: boolean; isThumbsUp?: boolean }
  | { type: "new_area_challenge"; challengeId: string; creatorId: string; area: string }
  | { type: "new_area_event"; challengeId: string; creatorId: string; area: string }
  | { type: "challenge_join"; challengeId: string; challengeCreatorId: string; joinerId: string }
  | { type: "challenge_invite"; challengeId: string; inviterId: string; invitedUserId: string }
  | { type: "challenge_spot_available"; challengeId: string; leaverId: string }
  | { type: "challenge_cancelled"; challengeId: string; creatorId: string }
  | { type: "account_report"; reportId: string; reporterId: string; reportedId: string };

type EventType = NotifyEvent["type"];

// Id fields every event type must carry (all uuids). `area` is checked separately.
const REQUIRED_IDS: Record<EventType, string[]> = {
  play_request: ["senderId", "receiverId"],
  new_message: ["conversationId", "senderId"],
  new_area_challenge: ["challengeId", "creatorId"],
  new_area_event: ["challengeId", "creatorId"],
  challenge_join: ["challengeId", "challengeCreatorId", "joinerId"],
  challenge_invite: ["challengeId", "inviterId", "invitedUserId"],
  challenge_spot_available: ["challengeId", "leaverId"],
  challenge_cancelled: ["challengeId", "creatorId"],
  account_report: ["reportId", "reporterId", "reportedId"],
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function parseEvent(body: unknown): NotifyEvent | null {
  if (!body || typeof body !== "object") return null;
  const candidate = body as Record<string, unknown>;
  // Own keys only: an inherited name ("constructor", "toString", "__proto__") must be an
  // unknown type (400), not a prototype member that makes ids.every throw (500). A
  // non-string type (e.g. ["play_request"], which would coerce to a key) is rejected too.
  if (typeof candidate.type !== "string" || !Object.hasOwn(REQUIRED_IDS, candidate.type)) return null;
  const type = candidate.type as EventType;
  const ids = REQUIRED_IDS[type];
  if (!ids.every((key) => typeof candidate[key] === "string" && UUID_RE.test(candidate[key] as string))) return null;
  if (type === "new_area_challenge" || type === "new_area_event") {
    if (typeof candidate.area !== "string") return null;
  }
  return candidate as unknown as NotifyEvent;
}

function actorIdOf(event: NotifyEvent): string {
  switch (event.type) {
    case "play_request":
    case "new_message":
      return event.senderId;
    case "challenge_join":
      return event.joinerId;
    case "challenge_invite":
      return event.inviterId;
    case "challenge_spot_available":
      return event.leaverId;
    case "account_report":
      return event.reporterId;
    default:
      return event.creatorId;
  }
}

// ── Delivery plan ────────────────────────────────────────────────────────────

type PrefColumn =
  | "play_requests_enabled"
  | "messages_enabled"
  | "images_enabled"
  | "area_challenges_enabled"
  | "challenge_joins_enabled"
  | "challenge_invites_enabled";

// direct    = a participant of the conversation / game (or its waitlist)
// player    = targeted personally, must be a Krossi player (tennis_preferences row)
// broadcast = area mail, must be a visible Krossi player
// admin     = moderation mail, no preference / block / profile filtering
type Audience = "direct" | "player" | "broadcast" | "admin";

interface EmailContent {
  subject: string;
  preheader: string;
  heading: string;
  paragraphs: string[];
  quote?: string | null;
  details?: string[];
  cta: { label: string; path: string };
}

interface Delivery {
  recipientIds: string[];
  audience: Audience;
  prefColumn: PrefColumn | null;
  throttle: { kinds: EventType[]; refId: string | null; windowMinutes: number };
  logRefId: string;
  content: EmailContent;
}

interface ChallengeRow {
  id: string;
  creator_id: string;
  status: string;
  challenge_type: string;
  match_type: string;
  location: string | null;
  location_type: string | null;
  city: string | null;
  scheduled_at: string | null;
  expires_at: string | null;
  created_at: string;
  title: string | null;
  max_players: number | null;
}

type Admin = SupabaseClient;

const CHALLENGE_COLUMNS =
  "id, creator_id, status, challenge_type, match_type, location, location_type, city, scheduled_at, expires_at, created_at, title, max_players";

async function fetchChallenge(admin: Admin, id: string): Promise<ChallengeRow | null> {
  const { data, error } = await admin.from("challenges").select(CHALLENGE_COLUMNS).eq("id", id).maybeSingle();
  if (error) throw error;
  return (data as ChallengeRow | null) ?? null;
}

async function fetchParticipantIds(admin: Admin, challengeId: string): Promise<string[]> {
  const { data, error } = await admin.from("challenge_participants").select("user_id").eq("challenge_id", challengeId);
  if (error) throw error;
  return (data ?? []).map((row) => row.user_id as string);
}

async function fetchFirstName(admin: Admin, userId: string): Promise<string> {
  const { data, error } = await admin.from("profiles").select("name").eq("id", userId).maybeSingle();
  if (error) throw error;
  return firstName(data?.name);
}

// Same capacity formula as the join_challenge RPC.
function spotsLeft(challenge: ChallengeRow, participantCount: number): number {
  let capacity = challenge.match_type === "nelinpeli" ? 3 : 1;
  if (challenge.max_players != null && challenge.max_players > 1) {
    capacity = Math.max(capacity, challenge.max_players - 1);
  }
  return Math.max(0, capacity - participantCount);
}

const gamePath = (id: string) => `/pelaa/peli/${id}`;

async function planPlayRequest(admin: Admin, event: Extract<NotifyEvent, { type: "play_request" }>): Promise<Delivery | null> {
  const { data: request, error } = await admin
    .from("connection_requests")
    .select("id, message")
    .eq("sender_id", event.senderId)
    .eq("receiver_id", event.receiverId)
    .eq("status", "pending")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!request) return null;

  const sender = await fetchFirstName(admin, event.senderId);
  return {
    recipientIds: [event.receiverId],
    audience: "player",
    prefColumn: "play_requests_enabled",
    throttle: { kinds: ["play_request"], refId: event.senderId, windowMinutes: 10 },
    logRefId: event.senderId,
    content: {
      subject: `${sender} haluaa pelata kanssasi 🎾`,
      preheader: `${sender} lähetti sinulle pelipyynnön Krossissa.`,
      heading: `${sender} pyytää sinua pelaamaan`,
      paragraphs: ["Vastaa pyyntöön, niin voitte sopia pelin heti viesteissä."],
      quote: truncate(request.message, 300),
      cta: { label: "Vastaa pyyntöön", path: "/pelaa/viestit" },
    },
  };
}

async function planNewMessage(admin: Admin, event: Extract<NotifyEvent, { type: "new_message" }>): Promise<Delivery | null> {
  const [{ data: participants, error: participantsError }, { data: message, error: messageError }, { data: conversation, error: conversationError }] =
    await Promise.all([
      admin.from("conversation_participants").select("user_id, last_read_at").eq("conversation_id", event.conversationId),
      admin
        .from("messages")
        .select("id, content, image_url, created_at")
        .eq("conversation_id", event.conversationId)
        .eq("sender_id", event.senderId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      admin.from("conversations").select("id, is_group, challenge_id").eq("id", event.conversationId).maybeSingle(),
    ]);
  if (participantsError) throw participantsError;
  if (messageError) throw messageError;
  if (conversationError) throw conversationError;

  const rows = (participants ?? []) as { user_id: string; last_read_at: string | null }[];
  if (!conversation || !message || !rows.some((row) => row.user_id === event.senderId)) return null;

  // Someone who has already opened the conversation after this message doesn't need a mail.
  const sentAt = Date.parse(message.created_at as string);
  const recipientIds = rows
    .filter((row) => row.user_id !== event.senderId)
    .filter((row) => !row.last_read_at || Date.parse(row.last_read_at) < sentAt)
    .map((row) => row.user_id);

  const sender = await fetchFirstName(admin, event.senderId);
  const hasImage = Boolean(message.image_url);
  const preview = messagePreview(message.content as string | null, hasImage);
  const inGameChat = Boolean(conversation.is_group);
  const subject = hasImage ? `${sender} lähetti kuvan` : preview === "👍" ? `${sender} vastasi 👍` : `Uusi viesti: ${sender}`;

  return {
    recipientIds,
    audience: "direct",
    prefColumn: hasImage ? "images_enabled" : "messages_enabled",
    throttle: { kinds: ["new_message"], refId: event.conversationId, windowMinutes: 30 },
    logRefId: event.conversationId,
    content: {
      subject,
      preheader: preview ?? `${sender} lähetti sinulle viestin Krossissa.`,
      heading: inGameChat ? `${sender} kirjoitti pelin keskusteluun` : `${sender} lähetti sinulle viestin`,
      paragraphs: [],
      quote: preview,
      cta: { label: "Avaa keskustelu", path: `/pelaa/viestit/${event.conversationId}` },
    },
  };
}

async function planAreaBroadcast(
  admin: Admin,
  event: Extract<NotifyEvent, { type: "new_area_challenge" | "new_area_event" }>,
): Promise<Delivery | null> {
  const challenge = await fetchChallenge(admin, event.challengeId);
  const isEvent = event.type === "new_area_event";
  if (!challenge || challenge.creator_id !== event.creatorId || challenge.status !== "open") return null;
  if (challenge.challenge_type !== (isEvent ? "event" : "open")) return null;
  if (challenge.expires_at && Date.parse(challenge.expires_at) <= Date.now()) return null;
  if (Date.now() - Date.parse(challenge.created_at) > AREA_BROADCAST_MAX_AGE_MINUTES * 60_000) return null;

  const area = challenge.city?.trim() || cleanArea(event.area);
  if (!area) return null;

  const { data: players, error } = await admin
    .from("profiles")
    .select("id, tennis_preferences!inner(user_id)")
    .neq("id", event.creatorId)
    .eq("hidden_from_feed", false)
    .ilike("area", `%${escapeLikePattern(area)}%`);
  if (error) throw error;

  const creator = await fetchFirstName(admin, event.creatorId);
  const participants = await fetchParticipantIds(admin, challenge.id);
  const left = spotsLeft(challenge, participants.length);
  const when = formatWhen(challenge.scheduled_at);

  const content: EmailContent = isEvent
    ? {
      subject: `Uusi tapahtuma: ${challenge.title?.trim() || area}`,
      preheader: `${when} · ${placeLabel(challenge)}`,
      heading: challenge.title?.trim() || `Uusi tennistapahtuma alueella ${area}`,
      paragraphs: [`${creator} julkaisi uuden tapahtuman Krossissa. Ilmoittaudu mukaan, ennen kuin paikat täyttyvät.`],
      details: gameDetails(challenge, left),
      cta: { label: "Katso tapahtuma", path: gamePath(challenge.id) },
    }
    : {
      subject: `${creator} hakee pelikaveria — ${when}`,
      preheader: `${matchTypeLabel(challenge.match_type)} · ${placeLabel(challenge)}`,
      heading: `Uusi peli alueella ${area}`,
      paragraphs: [`${creator} hakee pelikaveria. Liity mukaan, niin peli on sovittu.`],
      details: gameDetails(challenge, left),
      cta: { label: "Katso peli", path: gamePath(challenge.id) },
    };

  return {
    recipientIds: (players ?? []).map((row) => row.id as string),
    audience: "broadcast",
    prefColumn: "area_challenges_enabled",
    throttle: { kinds: ["new_area_challenge", "new_area_event"], refId: null, windowMinutes: 6 * 60 },
    logRefId: challenge.id,
    content,
  };
}

async function planChallengeJoin(admin: Admin, event: Extract<NotifyEvent, { type: "challenge_join" }>): Promise<Delivery | null> {
  const challenge = await fetchChallenge(admin, event.challengeId);
  if (!challenge || challenge.creator_id !== event.challengeCreatorId) return null;
  const participants = await fetchParticipantIds(admin, challenge.id);
  if (!participants.includes(event.joinerId)) return null;

  const joiner = await fetchFirstName(admin, event.joinerId);
  const left = spotsLeft(challenge, participants.length);
  return {
    recipientIds: [challenge.creator_id],
    audience: "direct",
    prefColumn: "challenge_joins_enabled",
    throttle: { kinds: ["challenge_join"], refId: `${challenge.id}:${event.joinerId}`, windowMinutes: 10 },
    logRefId: `${challenge.id}:${event.joinerId}`,
    content: {
      subject: `${joiner} liittyi peliisi!`,
      preheader: left === 0 ? "Peli on nyt täynnä — hyvää peliä!" : `${spotsText(left)}.`,
      heading: `${joiner} liittyi peliisi 🎾`,
      paragraphs: [left === 0 ? "Peli on nyt täynnä — hyvää peliä!" : `${spotsText(left)}. Jaa linkki kavereille, niin peli täyttyy nopeammin.`],
      details: gameDetails(challenge, left),
      cta: { label: "Katso peli", path: gamePath(challenge.id) },
    },
  };
}

async function planChallengeInvite(admin: Admin, event: Extract<NotifyEvent, { type: "challenge_invite" }>): Promise<Delivery | null> {
  const challenge = await fetchChallenge(admin, event.challengeId);
  if (!challenge || challenge.status === "cancelled") return null;
  const participants = await fetchParticipantIds(admin, challenge.id);
  if (challenge.creator_id !== event.inviterId && !participants.includes(event.inviterId)) return null;

  const { data: invite, error } = await admin
    .from("challenge_invites")
    .select("id")
    .eq("challenge_id", challenge.id)
    .eq("invited_user_id", event.invitedUserId)
    .eq("status", "pending")
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!invite) return null;

  const inviter = await fetchFirstName(admin, event.inviterId);
  const left = spotsLeft(challenge, participants.length);
  return {
    recipientIds: [event.invitedUserId],
    audience: "player",
    prefColumn: "challenge_invites_enabled",
    throttle: { kinds: ["challenge_invite"], refId: challenge.id, windowMinutes: 10 },
    logRefId: challenge.id,
    content: {
      subject: `${inviter} kutsuu sinut pelaamaan`,
      preheader: `${formatWhen(challenge.scheduled_at)} · ${placeLabel(challenge)}`,
      heading: `${inviter} kutsuu sinut peliin`,
      paragraphs: ["Pääsetkö mukaan? Vastaa kutsuun Krossissa."],
      details: gameDetails(challenge, left),
      cta: { label: "Katso kutsu", path: gamePath(challenge.id) },
    },
  };
}

async function planSpotAvailable(
  admin: Admin,
  event: Extract<NotifyEvent, { type: "challenge_spot_available" }>,
): Promise<Delivery | null> {
  const challenge = await fetchChallenge(admin, event.challengeId);
  if (!challenge || challenge.status !== "open") return null;
  const participants = await fetchParticipantIds(admin, challenge.id);
  if (participants.includes(event.leaverId)) return null;

  // Only the first person in the queue, like the push notification.
  const { data: queue, error } = await admin
    .from("challenge_waitlist")
    .select("user_id")
    .eq("challenge_id", challenge.id)
    .neq("user_id", event.leaverId)
    .order("created_at", { ascending: true })
    .limit(1);
  if (error) throw error;

  const left = spotsLeft(challenge, participants.length);
  return {
    recipientIds: (queue ?? []).map((row) => row.user_id as string),
    audience: "direct",
    prefColumn: "challenge_joins_enabled",
    throttle: { kinds: ["challenge_spot_available"], refId: challenge.id, windowMinutes: 10 },
    logRefId: challenge.id,
    content: {
      subject: "Paikka vapautui peliin!",
      preheader: "Olit jonossa — nyt pääset mukaan.",
      heading: "Paikka vapautui 🎾",
      paragraphs: ["Olit jonossa tähän peliin, ja nyt siihen vapautui paikka. Nopein ehtii — liity heti."],
      details: gameDetails(challenge, left),
      cta: { label: "Liity peliin", path: gamePath(challenge.id) },
    },
  };
}

async function planChallengeCancelled(
  admin: Admin,
  event: Extract<NotifyEvent, { type: "challenge_cancelled" }>,
): Promise<Delivery | null> {
  const challenge = await fetchChallenge(admin, event.challengeId);
  if (!challenge || challenge.creator_id !== event.creatorId || challenge.status !== "cancelled") return null;

  const [participants, { data: waitlist, error }] = await Promise.all([
    fetchParticipantIds(admin, challenge.id),
    admin.from("challenge_waitlist").select("user_id").eq("challenge_id", challenge.id),
  ]);
  if (error) throw error;

  const creator = await fetchFirstName(admin, event.creatorId);
  return {
    recipientIds: [...participants, ...(waitlist ?? []).map((row) => row.user_id as string)],
    audience: "direct",
    prefColumn: "challenge_joins_enabled",
    throttle: { kinds: ["challenge_cancelled"], refId: challenge.id, windowMinutes: 10 },
    logRefId: challenge.id,
    content: {
      subject: "Peli peruttiin",
      preheader: `${creator} perui pelin ${formatWhen(challenge.scheduled_at)}.`,
      heading: "Peli peruttiin",
      paragraphs: [`${creator} perui pelin, johon olit ilmoittautunut. Harmi! Katso, löytyykö tilalle toinen peli.`],
      details: gameDetails(challenge, null),
      cta: { label: "Etsi uusi peli", path: "/pelaa/pelit" },
    },
  };
}

async function planAccountReport(admin: Admin, event: Extract<NotifyEvent, { type: "account_report" }>): Promise<Delivery | null> {
  const { data: report, error } = await admin
    .from("reports")
    .select("id, reporter_id, reported_id, reason")
    .eq("id", event.reportId)
    .maybeSingle();
  if (error) throw error;
  if (!report || report.reporter_id !== event.reporterId) return null;

  const [reporter, reported] = await Promise.all([
    fetchFirstName(admin, report.reporter_id as string),
    fetchFirstName(admin, report.reported_id as string),
  ]);
  return {
    recipientIds: [ADMIN_USER_ID],
    audience: "admin",
    prefColumn: null,
    throttle: { kinds: ["account_report"], refId: event.reportId, windowMinutes: 10 },
    logRefId: event.reportId,
    content: {
      subject: "Uusi ilmianto Krossissa",
      preheader: `${reporter} ilmiantoi käyttäjän ${reported}.`,
      heading: "Uusi ilmianto",
      paragraphs: [`${reporter} ilmiantoi käyttäjän ${reported}.`],
      quote: truncate(report.reason as string | null, 500),
      cta: { label: "Avaa ylläpito", path: "/pelaa/yllapito" },
    },
  };
}

function planDelivery(admin: Admin, event: NotifyEvent): Promise<Delivery | null> {
  switch (event.type) {
    case "play_request":
      return planPlayRequest(admin, event);
    case "new_message":
      return planNewMessage(admin, event);
    case "new_area_challenge":
    case "new_area_event":
      return planAreaBroadcast(admin, event);
    case "challenge_join":
      return planChallengeJoin(admin, event);
    case "challenge_invite":
      return planChallengeInvite(admin, event);
    case "challenge_spot_available":
      return planSpotAvailable(admin, event);
    case "challenge_cancelled":
      return planChallengeCancelled(admin, event);
    case "account_report":
      return planAccountReport(admin, event);
  }
}

// ── Recipient filtering ──────────────────────────────────────────────────────

interface Recipient {
  id: string;
  name: string | null;
  email: string;
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}

// Runs `query` for each slice of `ids` (keeps PostgREST URLs short) and concatenates rows.
async function selectInChunks<T>(ids: string[], query: (slice: string[]) => PromiseLike<{ data: unknown; error: unknown }>): Promise<T[]> {
  const rows: T[] = [];
  for (const slice of chunk(ids, IN_QUERY_CHUNK)) {
    const { data, error } = await query(slice);
    if (error) throw error;
    rows.push(...((data ?? []) as T[]));
  }
  return rows;
}

async function withoutBlocked(admin: Admin, actorId: string, ids: string[]): Promise<string[]> {
  const [blockedByActor, blockingActor] = await Promise.all([
    selectInChunks<{ blocked_id: string }>(ids, (slice) =>
      admin.from("blocked_profiles").select("blocked_id").eq("blocker_id", actorId).in("blocked_id", slice)),
    selectInChunks<{ blocker_id: string }>(ids, (slice) =>
      admin.from("blocked_profiles").select("blocker_id").eq("blocked_id", actorId).in("blocker_id", slice)),
  ]);
  const blocked = new Set([...blockedByActor.map((r) => r.blocked_id), ...blockingActor.map((r) => r.blocker_id)]);
  return ids.filter((id) => !blocked.has(id));
}

async function withEmailPreference(admin: Admin, column: PrefColumn, ids: string[]): Promise<string[]> {
  const rows = await selectInChunks<Record<string, unknown>>(ids, (slice) =>
    admin.from("notification_preferences").select(`user_id, email_enabled, ${column}`).in("user_id", slice));
  const optedOut = new Set(rows.filter((row) => row.email_enabled === false || row[column] === false).map((row) => row.user_id as string));
  return ids.filter((id) => !optedOut.has(id));
}

interface ProfileInfo {
  id: string;
  name: string | null;
  hidden_from_feed: boolean;
  tennis_preferences: { user_id: string } | { user_id: string }[] | null;
}

async function loadProfiles(admin: Admin, ids: string[]): Promise<Map<string, ProfileInfo>> {
  const rows = await selectInChunks<ProfileInfo>(ids, (slice) =>
    admin.from("profiles").select("id, name, hidden_from_feed, tennis_preferences(user_id)").in("id", slice));
  return new Map(rows.map((row) => [row.id, row]));
}

function isKrossiPlayer(profile: ProfileInfo | undefined): boolean {
  const prefs = profile?.tennis_preferences;
  return Array.isArray(prefs) ? prefs.length > 0 : Boolean(prefs);
}

function matchesAudience(audience: Audience, profile: ProfileInfo | undefined): boolean {
  if (audience === "admin" || audience === "direct") return true;
  if (!isKrossiPlayer(profile)) return false;
  return audience === "player" || profile?.hidden_from_feed === false;
}

async function withoutThrottled(admin: Admin, throttle: Delivery["throttle"], ids: string[]): Promise<string[]> {
  const since = new Date(Date.now() - throttle.windowMinutes * 60_000).toISOString();
  const rows = await selectInChunks<{ user_id: string }>(ids, (slice) => {
    let query = admin
      .from("krossi_email_log")
      .select("user_id")
      .in("user_id", slice)
      .in("kind", throttle.kinds)
      .gte("sent_at", since);
    if (throttle.refId !== null) query = query.eq("ref_id", throttle.refId);
    return query;
  });
  const recent = new Set(rows.map((row) => row.user_id));
  return ids.filter((id) => !recent.has(id));
}

async function mapWithLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index]);
    }
  });
  await Promise.all(workers);
  return results;
}

// auth.users isn't exposed through PostgREST, so addresses come from the admin API.
// Unconfirmed addresses are skipped: nobody should get mail for an address they never proved.
async function lookupEmail(admin: Admin, id: string): Promise<string | null> {
  try {
    const { data, error } = await admin.auth.admin.getUserById(id);
    if (error || !data?.user?.email || !data.user.email_confirmed_at) return null;
    return data.user.email;
  } catch (error) {
    console.error("krossi-notify: email lookup failed", id, error);
    return null;
  }
}

interface Prepared {
  delivery: Delivery;
  recipients: Recipient[];
  candidates: number; // recipients before filtering; whatever isn't sent counts as skipped
}

async function prepare(admin: Admin, actorId: string, event: NotifyEvent): Promise<Prepared | null> {
  const delivery = await planDelivery(admin, event);
  if (!delivery) return null;

  let ids = [...new Set(delivery.recipientIds)].filter((id) => id !== actorId);
  const candidates = ids.length;
  if (ids.length === 0) return { delivery, recipients: [], candidates };

  if (delivery.audience !== "admin") ids = await withoutBlocked(admin, actorId, ids);
  if (ids.length && delivery.prefColumn) ids = await withEmailPreference(admin, delivery.prefColumn, ids);

  const profiles = ids.length ? await loadProfiles(admin, ids) : new Map<string, ProfileInfo>();
  ids = ids.filter((id) => matchesAudience(delivery.audience, profiles.get(id)));
  if (ids.length) ids = await withoutThrottled(admin, delivery.throttle, ids);

  const emails = await mapWithLimit(ids, EMAIL_LOOKUP_CONCURRENCY, (id) => lookupEmail(admin, id));
  const recipients = ids
    .map((id, index) => ({ id, name: profiles.get(id)?.name ?? null, email: emails[index] }))
    .filter((recipient): recipient is Recipient => Boolean(recipient.email));
  return { delivery, recipients, candidates };
}

// ── Sending ──────────────────────────────────────────────────────────────────

interface OutgoingEmail {
  recipientId: string;
  payload: { from: string; to: string[]; subject: string; html: string; text: string };
}

async function postToResend(url: string, apiKey: string, body: unknown): Promise<Response> {
  return await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

// Sends through the batch endpoint. Resend rejects a whole batch when one message is
// invalid, so a rejected batch is retried one by one: a single bad address can't
// cost everyone else their mail. Returns the ids of recipients whose mail was accepted.
async function sendAll(apiKey: string, emails: OutgoingEmail[]): Promise<string[]> {
  const delivered: string[] = [];
  for (const batch of chunk(emails, RESEND_BATCH_SIZE)) {
    try {
      const response = await postToResend(RESEND_BATCH_URL, apiKey, batch.map((email) => email.payload));
      if (response.ok) {
        delivered.push(...batch.map((email) => email.recipientId));
        continue;
      }
      console.error("krossi-notify: batch rejected", response.status, await response.text().catch(() => ""));
      if (response.status !== 400 && response.status !== 422) continue;
    } catch (error) {
      console.error("krossi-notify: batch request failed", error);
      continue;
    }
    for (const email of batch) {
      try {
        const response = await postToResend(RESEND_SINGLE_URL, apiKey, email.payload);
        if (response.ok) delivered.push(email.recipientId);
        else console.error("krossi-notify: send rejected", email.recipientId, response.status);
      } catch (error) {
        console.error("krossi-notify: send failed", email.recipientId, error);
      }
    }
  }
  return delivered;
}

async function logSent(admin: Admin, kind: EventType, refId: string, recipientIds: string[]) {
  if (recipientIds.length === 0) return;
  const { error } = await admin
    .from("krossi_email_log")
    .insert(recipientIds.map((userId) => ({ user_id: userId, kind, ref_id: refId })));
  if (error) console.error("krossi-notify: could not write email log", error);
}

// ── Formatting ───────────────────────────────────────────────────────────────

const MATCH_TYPE_LABELS: Record<string, string> = { kaksinpeli: "Kaksinpeli", nelinpeli: "Nelinpeli", pallottelu: "Pallottelu" };
const LOCATION_TYPE_LABELS: Record<string, string> = { "sisätennis": "Sisäkenttä", "ulkotennis": "Ulkokenttä", "missä vain": "Kenttä avoin" };

const helsinkiParts = new Intl.DateTimeFormat("fi-FI", {
  timeZone: "Europe/Helsinki",
  weekday: "short",
  day: "numeric",
  month: "numeric",
  hour: "numeric",
  minute: "2-digit",
  hourCycle: "h23",
});

// "la 3.10. klo 18" / "la 3.10. klo 18.30", always in Finnish time.
function formatWhen(iso: string | null): string {
  if (!iso) return "Aika sovitaan";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "Aika sovitaan";
  const parts = helsinkiParts.formatToParts(date);
  const part = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const hour = String(Number(part("hour")));
  const minute = part("minute");
  return `${part("weekday")} ${part("day")}.${part("month")}. klo ${hour}${minute && minute !== "00" ? `.${minute}` : ""}`;
}

function firstName(name: unknown): string {
  return (typeof name === "string" ? name.trim().split(/\s+/)[0] : "") || "Pelaaja";
}

function matchTypeLabel(matchType: string): string {
  return MATCH_TYPE_LABELS[matchType] ?? "Tennis";
}

function placeLabel(challenge: ChallengeRow): string {
  const location = challenge.location?.trim();
  const base = location && location !== "Avoin" ? location : LOCATION_TYPE_LABELS[challenge.location_type ?? ""] ?? "Kenttä avoin";
  const city = challenge.city?.trim();
  return city && !base.includes(city) ? `${base}, ${city}` : base;
}

function spotsText(left: number): string {
  return left === 1 ? "1 paikka vapaana" : `${left} paikkaa vapaana`;
}

function gameDetails(challenge: ChallengeRow, left: number | null): string[] {
  const kind = challenge.challenge_type === "event" && challenge.title?.trim()
    ? `${challenge.title.trim()} · ${matchTypeLabel(challenge.match_type)}`
    : matchTypeLabel(challenge.match_type);
  const lines = [`🗓 ${formatWhen(challenge.scheduled_at)}`, `📍 ${placeLabel(challenge)}`, `🎾 ${kind}`];
  if (left !== null) lines.push(left === 0 ? "✅ Peli on täynnä" : `👋 ${spotsText(left)}`);
  return lines;
}

function messagePreview(content: string | null, hasImage: boolean): string | null {
  if (hasImage) return "📷 Kuva";
  if (!content) return null;
  if (content.trim().startsWith("{")) {
    try {
      const payload = JSON.parse(content);
      if (payload?.__type === "thumbs_up") return "👍";
      if (payload?.__type === "challenge_join") return `${firstName(payload.joinerName)} liittyi peliin!`;
      if (payload?.__type) return null;
    } catch {
      // not JSON after all — an ordinary message that starts with "{"
    }
  }
  return truncate(content, 160);
}

function truncate(value: string | null | undefined, max: number): string | null {
  const text = (value ?? "").replace(/\s+/g, " ").trim();
  if (!text) return null;
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

function cleanArea(area: string): string {
  const value = area.split(",")[0]?.trim() ?? "";
  return /^[\p{L} -]{2,40}$/u.test(value) ? value : "";
}

function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string
  ));
}

function renderEmail(content: EmailContent, recipientName: string | null): { subject: string; html: string; text: string } {
  const greeting = `Moi ${firstName(recipientName)},`;
  const url = `${APP_ORIGIN}${content.cta.path}`;
  const footer = "Saat tämän viestin, koska käytät Krossia. Voit kytkeä sähköposti-ilmoitukset pois asetuksista:";

  const text = [
    greeting,
    "",
    content.heading,
    ...content.paragraphs,
    content.quote ? `\n"${content.quote}"` : "",
    ...(content.details?.length ? ["", ...content.details] : []),
    "",
    `${content.cta.label}: ${url}`,
    "",
    "—",
    `${footer} ${SETTINGS_URL}`,
  ].filter((line, index, lines) => line !== "" || lines[index - 1] !== "").join("\n");

  const paragraphs = content.paragraphs
    .map((p) => `<p style="margin:0 0 14px;font-size:15px;line-height:1.55;color:#3A372F">${escapeHtml(p)}</p>`)
    .join("");
  const quote = content.quote
    ? `<div style="margin:0 0 18px;padding:12px 16px;background:#F7F5EF;border-radius:14px;font-size:15px;line-height:1.5;color:#3A372F">&ldquo;${escapeHtml(content.quote)}&rdquo;</div>`
    : "";
  const details = content.details?.length
    ? `<div style="margin:0 0 22px;padding:14px 16px;border:1px solid #E5E1D7;border-radius:14px;font-size:14px;line-height:1.7;color:#121212">${
      content.details.map((line) => `<div>${escapeHtml(line)}</div>`).join("")
    }</div>`
    : "";

  const html = `<!doctype html><html lang="fi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${escapeHtml(content.subject)}</title></head>
<body style="margin:0;background:#F7F5EF;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','Helvetica Neue',Helvetica,Arial,sans-serif;color:#121212">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0">${escapeHtml(content.preheader)}</div>
  <div style="max-width:520px;margin:0 auto;padding:32px 20px">
    <div style="font-weight:800;font-size:22px;color:#0E3B2C;letter-spacing:-0.5px;margin-bottom:24px">Krossi</div>
    <div style="background:#FFFFFF;border:1px solid #D8D4CA;border-radius:18px;padding:26px 24px">
      <p style="margin:0 0 14px;font-size:15px;color:#6B665C">${escapeHtml(greeting)}</p>
      <h1 style="margin:0 0 12px;font-size:20px;line-height:1.3;font-weight:800;color:#121212">${escapeHtml(content.heading)}</h1>
      ${paragraphs}${quote}${details}
      <a href="${escapeHtml(url)}" style="display:inline-block;background:#CFE414;color:#121212;text-decoration:none;font-weight:800;font-size:15px;padding:13px 26px;border-radius:999px">${escapeHtml(content.cta.label)}</a>
    </div>
    <p style="margin:18px 0 0;font-size:12px;color:#8A857A;line-height:1.5">${escapeHtml(footer)} <a href="${SETTINGS_URL}" style="color:#0E3B2C;font-weight:700">krossi.app/pelaa/asetukset</a></p>
  </div>
</body></html>`;

  return { subject: content.subject, html, text };
}

// ── Handler ──────────────────────────────────────────────────────────────────

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (request.method !== "POST") {
    return json({ error: "Method not allowed." }, 405);
  }

  const authorization = request.headers.get("Authorization");
  if (!authorization) {
    return json({ error: "Unauthorized." }, 401);
  }

  const event = parseEvent(await request.json().catch(() => null));
  if (!event) {
    return json({ error: "Invalid event." }, 400);
  }

  const userClient = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false },
  });
  const { data: { user }, error: userError } = await userClient.auth.getUser();
  if (userError || !user) {
    return json({ error: "Unauthorized." }, 401);
  }

  const actorId = actorIdOf(event);
  if (user.id !== actorId) {
    return json({ error: "Unauthorized actor." }, 403);
  }

  const admin = createClient(supabaseUrl, supabaseServiceRoleKey, { auth: { persistSession: false } });

  let prepared: Prepared | null;
  try {
    prepared = await prepare(admin, actorId, event);
  } catch (error) {
    console.error("krossi-notify: could not resolve recipients", event.type, error);
    return json({ error: "Could not resolve recipients." }, 500);
  }
  if (!prepared) {
    return json({ sent: 0, skipped: 0 });
  }

  const { delivery, recipients, candidates } = prepared;
  if (recipients.length === 0) {
    return json({ sent: 0, skipped: candidates });
  }

  const resendKey = Deno.env.get("RESEND_API_KEY");
  if (!resendKey) {
    return json({ sent: 0, skipped: candidates, warning: "Sähköpostilähetintä ei ole vielä konfiguroitu." });
  }

  const mailFrom = Deno.env.get("KROSSI_MAIL_FROM") ?? Deno.env.get("KOUTSI_MAIL_FROM") ?? "messages@krossi.app";
  const mailFromName = Deno.env.get("KROSSI_MAIL_FROM_NAME") ?? "Krossi";
  const from = `${mailFromName} <${mailFrom}>`;

  const emails: OutgoingEmail[] = recipients.map((recipient) => ({
    recipientId: recipient.id,
    payload: { from, to: [recipient.email], ...renderEmail(delivery.content, recipient.name) },
  }));

  const delivered = await sendAll(resendKey, emails);
  await logSent(admin, event.type, delivery.logRefId, delivered);

  return json({ sent: delivered.length, skipped: candidates - delivered.length });
});
