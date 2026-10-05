// krossi-reminders — "Peli huomenna" -muistutukset Krossin peleistä (krossi.app/pelaa).
//
// Called once an hour by the pg_cron job 'krossi-game-reminders', which runs
// public.krossi_dispatch_game_reminders() (migration 20261005120000_krossi_game_reminders).
// Never called by a browser: deploy with verify_jwt = false. The only way in is the
// x-krossi-cron-key header, which is checked against the Vault secret 'krossi_cron_key'
// through public.krossi_cron_key_valid() — the key lives only in Vault, never in env.
//
// What it sends: for every Krossi game (challenge_type 'open'/'event', status 'open'/'filled',
// no outcome yet) starting between now + 2 h and now + 26 h, one email per person in the
// game (creator + challenge_participants): time, place, the other players' first names and
// a link to the game. A creator whose game still has nobody else in it gets a nudge to
// share the game instead.
//
// Who gets it — the same rules as krossi-notify:
//   * Krossi players only (profiles row with a tennis_preferences row), so a Koutsi-only
//     account never gets Krossi mail
//   * a confirmed email address (auth admin API)
//   * notification_preferences.email_enabled is not false (a missing row means "on")
//   * not already reminded about that game (krossi_email_log kind 'game_reminder',
//     ref_id = game id) — so each person gets at most one reminder per game, ever
//
// Gentle by design:
//   * no mail between 22.00 and 7.00 Finnish time (the run just does nothing; a game is in
//     the 24-hour window long enough for a daytime run to pick it up)
//   * someone who joined (or created the game) within the last hour waits for the next run
//   * the "nobody has joined" nudge only goes out once the game is at least 3 h old
//   * at most 300 emails per run; the rest go out on the next run, soonest games first
//
// Body: { "type": "game_reminders" }. Add "dryRun": true to get the counts without sending
// anything or writing the log (quiet hours are reported but not enforced in a dry run).
//
// Required secrets (project-wide, already set for krossi-notify):
//   RESEND_API_KEY        Resend API key
// Optional:
//   KROSSI_MAIL_FROM      sender address (falls back to KOUTSI_MAIL_FROM, then messages@krossi.app)
//   KROSSI_MAIL_FROM_NAME (default "Krossi")
//
// Response: { sent, skipped, deferred } — a failing recipient is counted as skipped, never a 500.
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";

const supabaseUrl = Deno.env.get("SUPABASE_URL");
const secretKeys = Deno.env.get("SUPABASE_SECRET_KEYS");
const supabaseServiceRoleKey = secretKeys ? JSON.parse(secretKeys).default : Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

if (!supabaseUrl || !supabaseServiceRoleKey) {
  throw new Error("Supabase function environment variables are missing.");
}

const APP_ORIGIN = "https://krossi.app";
const SETTINGS_URL = `${APP_ORIGIN}/pelaa/asetukset`;
const RESEND_BATCH_URL = "https://api.resend.com/emails/batch";
const RESEND_SINGLE_URL = "https://api.resend.com/emails";
const RESEND_BATCH_SIZE = 100;
// Resend's default rate limit is a couple of requests per second.
const RESEND_BATCH_PAUSE_MS = 600;
const IN_QUERY_CHUNK = 100;
const EMAIL_LOOKUP_CONCURRENCY = 8;

const LOG_KIND = "game_reminder";
const WINDOW_START_HOURS = 2;
const WINDOW_END_HOURS = 26;
const MAX_GAMES_PER_RUN = 500;
const MAX_EMAILS_PER_RUN = 300;
// Finnish time: no mail from QUIET_FROM.00 until QUIET_UNTIL.00.
const QUIET_FROM_HOUR = 22;
const QUIET_UNTIL_HOUR = 7;
const JOIN_GRACE_MINUTES = 60;
const NUDGE_MIN_GAME_AGE_HOURS = 3;
const NAMES_SHOWN = 4;
const MAX_CRON_KEY_LENGTH = 256;

const HOUR_MS = 3_600_000;
const MINUTE_MS = 60_000;

type Admin = SupabaseClient;

// ── Data ─────────────────────────────────────────────────────────────────────

interface GameRow {
  id: string;
  creator_id: string;
  status: string;
  challenge_type: string;
  match_type: string;
  location: string | null;
  location_type: string | null;
  city: string | null;
  scheduled_at: string;
  expires_at: string | null;
  created_at: string;
  title: string | null;
  max_players: number | null;
}

const GAME_COLUMNS =
  "id, creator_id, status, challenge_type, match_type, location, location_type, city, scheduled_at, expires_at, created_at, title, max_players";

interface ParticipantRow {
  challenge_id: string;
  user_id: string;
  created_at: string;
}

interface ProfileInfo {
  id: string;
  name: string | null;
  tennis_preferences: { user_id: string } | { user_id: string }[] | null;
}

// One email to write: this person, this game.
interface Reminder {
  game: GameRow;
  userId: string;
  recipientName: string | null;
  nudge: boolean;
  others: string[]; // first names of everyone else in the game, creator first
  spotsLeft: number;
}

interface Plan {
  pending: number; // people in upcoming games who haven't been reminded yet
  reminders: Reminder[]; // eligible, soonest game first, capped at MAX_EMAILS_PER_RUN
  deferred: number; // eligible but over the cap — next run
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

function isKrossiPlayer(profile: ProfileInfo | undefined): boolean {
  const prefs = profile?.tennis_preferences;
  return Array.isArray(prefs) ? prefs.length > 0 : Boolean(prefs);
}

// Same capacity formula as the join_challenge RPC (and krossi-notify).
function spotsLeft(game: GameRow, participantCount: number): number {
  let capacity = game.match_type === "nelinpeli" ? 3 : 1;
  if (game.max_players != null && game.max_players > 1) {
    capacity = Math.max(capacity, game.max_players - 1);
  }
  return Math.max(0, capacity - participantCount);
}

async function planReminders(admin: Admin, now: number): Promise<Plan> {
  const { data: gameData, error: gamesError } = await admin
    .from("challenges")
    .select(GAME_COLUMNS)
    .in("challenge_type", ["open", "event"])
    .in("status", ["open", "filled"])
    .is("outcome", null)
    .gte("scheduled_at", new Date(now + WINDOW_START_HOURS * HOUR_MS).toISOString())
    .lte("scheduled_at", new Date(now + WINDOW_END_HOURS * HOUR_MS).toISOString())
    .order("scheduled_at", { ascending: true })
    .limit(MAX_GAMES_PER_RUN);
  if (gamesError) throw gamesError;

  const games = ((gameData ?? []) as GameRow[]).filter((game) => !game.expires_at || Date.parse(game.expires_at) > now);
  if (games.length === 0) return { pending: 0, reminders: [], deferred: 0 };
  const gameIds = games.map((game) => game.id);

  const [participantRows, logRows] = await Promise.all([
    selectInChunks<ParticipantRow>(gameIds, (slice) =>
      admin.from("challenge_participants").select("challenge_id, user_id, created_at").in("challenge_id", slice)),
    selectInChunks<{ user_id: string; ref_id: string }>(gameIds, (slice) =>
      admin.from("krossi_email_log").select("user_id, ref_id").eq("kind", LOG_KIND).in("ref_id", slice)),
  ]);

  const participantsByGame = new Map<string, ParticipantRow[]>();
  for (const row of participantRows) {
    const list = participantsByGame.get(row.challenge_id) ?? [];
    list.push(row);
    participantsByGame.set(row.challenge_id, list);
  }
  for (const list of participantsByGame.values()) list.sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));
  const alreadyReminded = new Set(logRows.map((row) => `${row.ref_id}:${row.user_id}`));

  // Who could get a mail this run, before any per-user checks.
  interface Draft {
    game: GameRow;
    userId: string;
    nudge: boolean;
    people: string[];
    participantCount: number;
  }
  const drafts: Draft[] = [];
  let pending = 0;
  for (const game of games) {
    const participants = (participantsByGame.get(game.id) ?? []).filter((row) => row.user_id !== game.creator_id);
    const people = [game.creator_id, ...participants.map((row) => row.user_id)];
    const joinedAt = new Map<string, number>([
      [game.creator_id, Date.parse(game.created_at)],
      ...participants.map((row): [string, number] => [row.user_id, Date.parse(row.created_at)]),
    ]);

    for (const userId of new Set(people)) {
      if (alreadyReminded.has(`${game.id}:${userId}`)) continue;
      pending++;
      // Just joined / just created: they know about the game already. Next run.
      if (now - (joinedAt.get(userId) ?? 0) < JOIN_GRACE_MINUTES * MINUTE_MS) continue;

      const nudge = userId === game.creator_id && participants.length === 0;
      if (nudge && (game.status !== "open" || now - Date.parse(game.created_at) < NUDGE_MIN_GAME_AGE_HOURS * HOUR_MS)) continue;
      drafts.push({ game, userId, nudge, people, participantCount: participants.length });
    }
  }
  if (drafts.length === 0) return { pending, reminders: [], deferred: 0 };

  const recipientIds = [...new Set(drafts.map((draft) => draft.userId))];
  const everyoneIds = [...new Set(drafts.flatMap((draft) => draft.people))];
  const [prefRows, profileRows] = await Promise.all([
    selectInChunks<{ user_id: string; email_enabled: boolean | null }>(recipientIds, (slice) =>
      admin.from("notification_preferences").select("user_id, email_enabled").in("user_id", slice)),
    selectInChunks<ProfileInfo>(everyoneIds, (slice) =>
      admin.from("profiles").select("id, name, tennis_preferences(user_id)").in("id", slice)),
  ]);
  const optedOut = new Set(prefRows.filter((row) => row.email_enabled === false).map((row) => row.user_id));
  const profiles = new Map(profileRows.map((row) => [row.id, row]));

  const eligible: Reminder[] = drafts
    .filter((draft) => !optedOut.has(draft.userId) && isKrossiPlayer(profiles.get(draft.userId)))
    .map((draft) => ({
      game: draft.game,
      userId: draft.userId,
      recipientName: profiles.get(draft.userId)?.name ?? null,
      nudge: draft.nudge,
      others: draft.people.filter((id) => id !== draft.userId).map((id) => firstName(profiles.get(id)?.name)),
      spotsLeft: spotsLeft(draft.game, draft.participantCount),
    }));

  // drafts follow the games' scheduled_at order, so the soonest games go first.
  return {
    pending,
    reminders: eligible.slice(0, MAX_EMAILS_PER_RUN),
    deferred: Math.max(0, eligible.length - MAX_EMAILS_PER_RUN),
  };
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
    console.error("krossi-reminders: email lookup failed", id, error);
    return null;
  }
}

// ── Sending ──────────────────────────────────────────────────────────────────

interface OutgoingEmail {
  userId: string;
  gameId: string;
  payload: { from: string; to: string[]; subject: string; html: string; text: string };
}

async function postToResend(url: string, apiKey: string, body: unknown): Promise<Response> {
  return await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Sends through the batch endpoint. Resend rejects a whole batch when one message is
// invalid, so a rejected batch is retried one by one: a single bad address can't
// cost everyone else their mail. Returns the emails Resend accepted.
async function sendAll(apiKey: string, emails: OutgoingEmail[]): Promise<OutgoingEmail[]> {
  const delivered: OutgoingEmail[] = [];
  const batches = chunk(emails, RESEND_BATCH_SIZE);
  for (const [index, batch] of batches.entries()) {
    if (index > 0) await pause(RESEND_BATCH_PAUSE_MS);
    try {
      const response = await postToResend(RESEND_BATCH_URL, apiKey, batch.map((email) => email.payload));
      if (response.ok) {
        delivered.push(...batch);
        continue;
      }
      console.error("krossi-reminders: batch rejected", response.status, await response.text().catch(() => ""));
      if (response.status !== 400 && response.status !== 422) continue;
    } catch (error) {
      console.error("krossi-reminders: batch request failed", error);
      continue;
    }
    for (const email of batch) {
      try {
        const response = await postToResend(RESEND_SINGLE_URL, apiKey, email.payload);
        if (response.ok) delivered.push(email);
        else console.error("krossi-reminders: send rejected", email.userId, email.gameId, response.status);
      } catch (error) {
        console.error("krossi-reminders: send failed", email.userId, email.gameId, error);
      }
    }
  }
  return delivered;
}

async function logSent(admin: Admin, delivered: OutgoingEmail[]) {
  for (const rows of chunk(delivered, 500)) {
    const { error } = await admin
      .from("krossi_email_log")
      .insert(rows.map((email) => ({ user_id: email.userId, kind: LOG_KIND, ref_id: email.gameId })));
    if (error) console.error("krossi-reminders: could not write email log", error);
  }
}

// ── Formatting ───────────────────────────────────────────────────────────────

const MATCH_TYPE_LABELS: Record<string, string> = { kaksinpeli: "Kaksinpeli", nelinpeli: "Nelinpeli", pallottelu: "Pallottelu" };
const LOCATION_TYPE_LABELS: Record<string, string> = { "sisätennis": "Sisäkenttä", "ulkotennis": "Ulkokenttä", "missä vain": "Kenttä avoin" };

const helsinkiParts = new Intl.DateTimeFormat("fi-FI", {
  timeZone: "Europe/Helsinki",
  weekday: "short",
  day: "numeric",
  month: "numeric",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
  hourCycle: "h23",
});

interface HelsinkiTime {
  weekday: string; // "la"
  day: number;
  month: number;
  year: number;
  hour: number;
  minute: number;
}

function helsinkiTime(date: Date): HelsinkiTime {
  const parts = helsinkiParts.formatToParts(date);
  const part = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return {
    weekday: part("weekday"),
    day: Number(part("day")),
    month: Number(part("month")),
    year: Number(part("year")),
    hour: Number(part("hour")) % 24,
    minute: Number(part("minute")),
  };
}

function isQuietHour(now: Date): boolean {
  const { hour } = helsinkiTime(now);
  return hour >= QUIET_FROM_HOUR || hour < QUIET_UNTIL_HOUR;
}

// "18" / "18.30"
function clock(t: HelsinkiTime): string {
  return t.minute ? `${t.hour}.${String(t.minute).padStart(2, "0")}` : String(t.hour);
}

// "tänään" / "huomenna" / "la 10.10." — calendar days in Finnish time.
function dayWord(when: HelsinkiTime, now: HelsinkiTime): string {
  const days = (Date.UTC(when.year, when.month - 1, when.day) - Date.UTC(now.year, now.month - 1, now.day)) / 86_400_000;
  if (days === 0) return "tänään";
  if (days === 1) return "huomenna";
  return `${when.weekday} ${when.day}.${when.month}.`;
}

function capitalize(value: string): string {
  return value ? value[0].toLocaleUpperCase("fi-FI") + value.slice(1) : value;
}

// "la 3.10. klo 18" / "la 3.10. klo 18.30" — same as krossi-notify's details line.
function formatWhen(iso: string): string {
  const t = helsinkiTime(new Date(iso));
  return `${t.weekday} ${t.day}.${t.month}. klo ${clock(t)}`;
}

function firstName(name: unknown): string {
  return (typeof name === "string" ? name.trim().split(/\s+/)[0] : "") || "Pelaaja";
}

function matchTypeLabel(matchType: string): string {
  return MATCH_TYPE_LABELS[matchType] ?? "Tennis";
}

function placeLabel(game: GameRow): string {
  const location = game.location?.trim();
  const base = location && location !== "Avoin" ? location : LOCATION_TYPE_LABELS[game.location_type ?? ""] ?? "Kenttä avoin";
  const city = game.city?.trim();
  return city && !base.includes(city) ? `${base}, ${city}` : base;
}

// Short place for the subject line: the court if one is set, else the city, else nothing.
function subjectPlace(game: GameRow): string {
  const location = game.location?.trim();
  if (location && location !== "Avoin") return location;
  return game.city?.trim() ?? "";
}

function spotsText(left: number): string {
  return left === 1 ? "1 paikka vapaana" : `${left} paikkaa vapaana`;
}

function gameDetails(game: GameRow, left: number): string[] {
  const kind = game.challenge_type === "event" && game.title?.trim()
    ? `${game.title.trim()} · ${matchTypeLabel(game.match_type)}`
    : matchTypeLabel(game.match_type);
  return [
    `🗓 ${formatWhen(game.scheduled_at)}`,
    `📍 ${placeLabel(game)}`,
    `🎾 ${kind}`,
    left === 0 ? "✅ Peli on täynnä" : `👋 ${spotsText(left)}`,
  ];
}

// "Matti", "Matti ja Liisa", "Matti, Liisa ja Pekka", "Matti, Liisa, Pekka, Anna ja 6 muuta".
// Never "ja 1 muu": one extra name is simply listed.
function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  if (names.length > NAMES_SHOWN + 1) {
    return `${names.slice(0, NAMES_SHOWN).join(", ")} ja ${names.length - NAMES_SHOWN} muuta`;
  }
  return `${names.slice(0, -1).join(", ")} ja ${names[names.length - 1]}`;
}

function truncate(value: string, max: number): string {
  const text = value.replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

interface EmailContent {
  subject: string;
  preheader: string;
  heading: string;
  paragraphs: string[];
  details?: string[];
  cta: { label: string; path: string };
}

const CALENDAR_HINT = "Vinkki: pelin sivun Lisää kalenteriin -napilla peli tallentuu suoraan kalenteriisi.";

function reminderContent(reminder: Reminder, nowParts: HelsinkiTime): EmailContent {
  const { game } = reminder;
  const when = helsinkiTime(new Date(game.scheduled_at));
  const day = dayWord(when, nowParts);
  const time = `klo ${clock(when)}`;
  const isEvent = game.challenge_type === "event";
  const title = isEvent ? game.title?.trim() || "" : "";
  const path = `/pelaa/peli/${game.id}`;
  const cta = { label: isEvent ? "Avaa tapahtuma" : "Avaa peli", path };
  const details = gameDetails(game, reminder.spotsLeft);

  if (reminder.nudge) {
    const noun = isEvent ? "tapahtuma" : "peli";
    return {
      subject: `${capitalize(day)} ${time}: kukaan ei ole vielä liittynyt ${isEvent ? "tapahtumaasi" : "peliisi"}`,
      preheader: `Jaa ${noun} kavereille, niin ${isEvent ? "saat porukan kasaan" : "saat pelikaverin"}.`,
      heading: `Kukaan ei ole vielä liittynyt — jaa ${noun} kavereille`,
      paragraphs: [
        `${isEvent ? "Tapahtumasi" : "Pelisi"} on ${day} ${time}, mutta kukaan ei ole vielä ilmoittautunut mukaan. Jaa linkki kavereille tai porukan WhatsApp-ryhmään, niin ${noun} täyttyy nopeammin.`,
        "Pelin sivulta voit myös kutsua suoraan pelikavereitasi.",
      ],
      details,
      cta,
    };
  }

  const kind = title || matchTypeLabel(game.match_type);
  const place = subjectPlace(game);
  const subjectWhat = title || (place ? `${kind} · ${place}` : kind);
  const others = joinNames(reminder.others);
  const isCreator = reminder.userId === game.creator_id;
  return {
    subject: truncate(`${capitalize(day)} ${time}: ${subjectWhat}`, 120),
    preheader: others ? `Mukana ${others}. Hyvää peliä!` : `${placeLabel(game)} · hyvää peliä!`,
    heading: `${title || "Peli"} ${day} ${time} 🎾`,
    paragraphs: [
      others ? `${capitalize(day)} pelataan! Mukana ${others}.` : `${capitalize(day)} pelataan!`,
      `Pakkaa maila ja juomapullo — hyvää peliä! ${
        isCreator
          ? "Jos peli ei onnistukaan, peru se ajoissa pelin sivulta, niin muut tietävät."
          : "Jos et pääsekään, poistu pelistä ajoissa, niin joku muu ehtii tilallesi."
      }`,
      CALENDAR_HINT,
    ],
    details,
    cta,
  };
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string
  ));
}

// Same layout as krossi-notify's renderEmail (minus the quote block, unused here).
function renderEmail(content: EmailContent, recipientName: string | null): { subject: string; html: string; text: string } {
  const greeting = `Moi ${firstName(recipientName)},`;
  const url = `${APP_ORIGIN}${content.cta.path}`;
  const footer = "Saat tämän viestin, koska käytät Krossia. Voit kytkeä sähköposti-ilmoitukset pois asetuksista:";

  const text = [
    greeting,
    "",
    content.heading,
    ...content.paragraphs,
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
      ${paragraphs}${details}
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
    headers: { "Content-Type": "application/json" },
  });
}

const admin = createClient(supabaseUrl, supabaseServiceRoleKey, { auth: { persistSession: false } });

Deno.serve(async (request) => {
  if (request.method !== "POST") {
    return json({ error: "Method not allowed." }, 405);
  }

  const cronKey = request.headers.get("x-krossi-cron-key") ?? "";
  if (!cronKey || cronKey.length > MAX_CRON_KEY_LENGTH) {
    return json({ error: "Unauthorized." }, 401);
  }
  const { data: keyValid, error: keyError } = await admin.rpc("krossi_cron_key_valid", { key_input: cronKey });
  if (keyError) {
    console.error("krossi-reminders: could not verify the cron key", keyError);
    return json({ error: "Could not verify caller." }, 500);
  }
  if (keyValid !== true) {
    return json({ error: "Unauthorized." }, 401);
  }

  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body || typeof body !== "object" || body.type !== "game_reminders") {
    return json({ error: "Invalid request." }, 400);
  }
  const dryRun = body.dryRun === true;

  const now = new Date();
  const quietHours = isQuietHour(now);
  if (quietHours && !dryRun) {
    return json({ sent: 0, skipped: 0, deferred: 0, quietHours: true });
  }

  let plan: Plan;
  try {
    plan = await planReminders(admin, now.getTime());
  } catch (error) {
    console.error("krossi-reminders: could not plan reminders", error);
    return json({ error: "Could not plan reminders." }, 500);
  }

  const { pending, reminders, deferred } = plan;
  const waiting = pending - deferred; // everything not sent this run and not deferred is skipped
  if (reminders.length === 0) {
    return json({ sent: 0, skipped: waiting, deferred, ...(dryRun ? { dryRun, quietHours, wouldSend: 0 } : {}) });
  }

  const userIds = [...new Set(reminders.map((reminder) => reminder.userId))];
  const emails = await mapWithLimit(userIds, EMAIL_LOOKUP_CONCURRENCY, (id) => lookupEmail(admin, id));
  const emailById = new Map(userIds.map((id, index) => [id, emails[index]]));

  const resendKey = Deno.env.get("RESEND_API_KEY");
  const mailFrom = Deno.env.get("KROSSI_MAIL_FROM") ?? Deno.env.get("KOUTSI_MAIL_FROM") ?? "messages@krossi.app";
  const mailFromName = Deno.env.get("KROSSI_MAIL_FROM_NAME") ?? "Krossi";
  const from = `${mailFromName} <${mailFrom}>`;
  const nowParts = helsinkiTime(now);

  const outgoing: OutgoingEmail[] = [];
  for (const reminder of reminders) {
    const email = emailById.get(reminder.userId);
    if (!email) continue;
    outgoing.push({
      userId: reminder.userId,
      gameId: reminder.game.id,
      payload: { from, to: [email], ...renderEmail(reminderContent(reminder, nowParts), reminder.recipientName) },
    });
  }

  if (dryRun) {
    return json({ sent: 0, skipped: waiting - outgoing.length, deferred, dryRun, quietHours, wouldSend: outgoing.length });
  }
  if (outgoing.length === 0) {
    return json({ sent: 0, skipped: waiting, deferred });
  }
  if (!resendKey) {
    return json({ sent: 0, skipped: waiting, deferred, warning: "Sähköpostilähetintä ei ole vielä konfiguroitu." });
  }

  const delivered = await sendAll(resendKey, outgoing);
  await logSent(admin, delivered);

  return json({ sent: delivered.length, skipped: waiting - delivered.length, deferred });
});
