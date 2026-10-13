// errors.js — every data-layer failure reaches the UI as an ApiError with a Finnish,
// user-presentable message. Screens show `err.userMessage` and never parse raw errors.
//
// The phrasebook is the old Koutsi's (lib/koutsi-data.js KOUTSI_ERROR_PATTERNS): a coach on
// court should never read a Postgres sentence or a table name.

export class ApiError extends Error {
  constructor(userMessage, { cause, code } = {}) {
    super(userMessage);
    this.name = 'ApiError';
    this.userMessage = userMessage;
    this.code = code || null;
    if (cause) this.cause = cause;
  }
}

const KNOWN = [
  [/invalid login credentials/i, 'Sähköposti tai salasana ei täsmää.', 'bad_credentials'],
  [/email not confirmed/i, 'Vahvista ensin sähköpostiosoitteesi vahvistusviestin linkistä.', 'email_unconfirmed'],
  [/user already registered|already been registered/i, 'Tällä sähköpostilla on jo tili. Kirjaudu sisään.', 'already_registered'],
  [/password should be at least|password is too short/i, 'Salasanan pitää olla vähintään 8 merkkiä.', 'weak_password'],
  [/(new )?password should be different/i, 'Uusi salasana ei voi olla sama kuin vanha.', 'same_password'],
  [/for security purposes|rate limit|too many requests/i, 'Liian monta yritystä. Odota hetki ja yritä uudelleen.', 'rate_limited'],
  [/invalid invite code/i, 'Koodia ei löytynyt. Tarkista kirjoitusasu.', 'bad_code'],
  [/invite code has expired/i, 'Koodi on vanhentunut. Pyydä valmentajalta uusi.', 'code_expired'],
  [/invite code has been revoked/i, 'Koodi on poistettu käytöstä. Pyydä valmentajalta uusi.', 'code_revoked'],
  [/invite code has reached its use limit/i, 'Koodi on jo käytetty. Pyydä valmentajalta uusi.', 'code_used'],
  [/authentication required/i, 'Istuntosi on vanhentunut. Kirjaudu sisään uudelleen.', 'auth_required'],
  [/Anna pelaajalle nimi/i, 'Anna pelaajalle nimi.', null],
  [/Tätä profiilia ei voi lunastaa/i, 'Tätä profiilia ei voi lunastaa. Pyydä valmentajalta uusi koodi.', 'cannot_claim'],
  [/own coach code|koutsi_coach_students_check/i, 'Tämä on oma valmentajakoodisi. Anna se pelaajalle — sinun ei tarvitse liittyä itse.', 'own_code'],
  [/invalid coach key/i, 'Väärä valmentaja-avain.', 'bad_key'],
  [/coach key has expired/i, 'Valmentaja-avain on vanhentunut.', 'key_expired'],
  [/coach key has been revoked/i, 'Valmentaja-avain on poistettu käytöstä.', 'key_revoked'],
  [/coach key has already been used/i, 'Valmentaja-avain on jo käytetty.', 'key_used'],
  [/profile required/i, 'Luo ensin profiilisi.', 'profile_required'],
  [/not a coach/i, 'Tiliäsi ei ole liitetty valmentajaksi.', 'not_coach'],
  [/duplicate key|already exists/i, 'Tämä on jo olemassa.', 'duplicate'],
  [/violates foreign key/i, 'Kohdetta ei löytynyt — se on ehkä juuri poistettu.', 'missing_target'],
  [/video share not found/i, 'Videojakoa ei enää löytynyt. Päivitä näkymä.', 'missing_target'],
  [/choose at least one recipient/i, 'Valitse vähintään yksi pelaaja.', null],
  [/recipient is not linked to this coach/i, 'Valittu pelaaja ei ole enää valmennuksessasi. Päivitä näkymä.', null],
  [/liity ensin valmentajan sinulle lähettämällä henkilökohtaisella linkillä/i, 'Alaikäisen tili aktivoidaan valmentajan lähettämästä henkilökohtaisesta liittymislinkistä. Pyydä valmentajalta uusi linkki.', 'minor_personal_link'],
  [/alaikäinen tietää Koutsin käytöstä/i, 'Valmentajan pitää ensin vahvistaa, että alaikäinen tietää Koutsin käytöstä.', 'minor_notice'],
  [/alle 13-vuotiaan.*huoltajan hyväksynnän/i, 'Alle 13-vuotiaan tilin aktivointi vaatii huoltajan hyväksynnän, jonka valmentaja vahvistaa kutsussa.', 'guardian_required'],
  [/aikuisten beta-pilotissa|rajattu vähintään 18-vuotiaille/i, 'Tämä vanha pilottirajaus ei ole enää käytössä. Päivitä sivu ja yritä uudelleen.', null],
  [/poissaolon syytä ei tallenneta/i, 'Pilotissa poissaolosta tallennetaan vain poissa-merkintä, ei syytä.', null],
  [/cannot delete your own admin account/i, 'Et voi poistaa omaa ylläpitäjätiliäsi tästä näkymästä.', 'forbidden'],
  [/cannot delete an administrator/i, 'Ylläpitäjätiliä ei voi poistaa tästä näkymästä.', 'forbidden'],
  [/user not found/i, 'Käyttäjää ei enää löytynyt. Päivitä näkymä.', 'missing_target'],
  [/violates row-level security|permission denied|not allowed/i, 'Sinulla ei ole oikeutta tähän.', 'forbidden'],
  [/payload too large|exceeded the maximum allowed size/i, 'Tiedosto on liian suuri.', 'too_large'],
  [/mime type .* is not supported|invalid_mime_type/i, 'Tätä tiedostotyyppiä ei tueta.', 'bad_type'],
  [/failed to fetch|networkerror|network request failed|load failed/i, 'Yhteysvirhe. Tarkista verkkoyhteys ja yritä uudelleen.', 'network'],
  [/jwt expired|invalid claim|session.*expired/i, 'Istunto vanheni. Kirjaudu uudelleen sisään.', 'auth_required'],
];

const FALLBACK = 'Jokin meni pieleen. Yritä uudelleen.';

/** Wraps anything thrown by supabase-js (or our own code) into an ApiError. */
export function toApiError(err, fallback = FALLBACK) {
  if (err instanceof ApiError) return err;
  const raw = typeof err === 'string' ? err : String(err?.message || err?.error_description || '');
  if (raw) {
    for (const [re, msg, code] of KNOWN) if (re.test(raw)) return new ApiError(msg, { cause: err, code });
    // Our own SQL and our own guards raise Finnish sentences; those are safe to show — but not
    // a mixed sentence that carries a raw English storage error after a semicolon.
    if (/[äöÄÖ]/.test(raw) && raw.length < 200 && !raw.includes(';')) return new ApiError(raw, { cause: err });
  }
  return new ApiError(fallback, { cause: err, code: err?.code || null });
}

/** Throws the Supabase `{ error }` if present, otherwise returns `data`. */
export function unwrap({ data, error }, fallback) {
  if (error) throw toApiError(error, fallback);
  return data;
}
