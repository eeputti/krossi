// errors.js — every data-layer failure reaches the UI as an ApiError with a Finnish,
// user-presentable message. Screens show `err.userMessage` and never parse raw errors.

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
  [/payment required/i, 'Tämä toiminto vaatii Krossin avaamisen.', 'payment_required'],
  [/row-level security/i, 'Sinulla ei ole oikeutta tähän.', 'forbidden'],
  [/challenge is full/i, 'Peli ehti täyttyä. Liity jonoon, niin saat paikan jos joku peruu.', 'full'],
  [/challenge is cancelled/i, 'Tämä peli on peruttu.', 'cancelled'],
  [/creator cannot join/i, 'Et voi liittyä omaan peliisi.', 'own_game'],
  [/invalid login credentials/i, 'Sähköposti tai salasana on väärin.', 'bad_credentials'],
  [/email not confirmed/i, 'Vahvista sähköpostiosoitteesi ensin — katso saapuneet viestit.', 'email_unconfirmed'],
  [/user already registered/i, 'Tällä sähköpostilla on jo tili. Kirjaudu sisään.', 'already_registered'],
  [/failed to fetch|network/i, 'Yhteys katkesi. Tarkista nettiyhteys ja yritä uudelleen.', 'network'],
  [/duplicate key/i, 'Tämä on jo tehty.', 'duplicate'],
];

/** Wraps anything thrown by supabase-js (or our own code) into an ApiError. */
export function toApiError(err, fallback = 'Jokin meni pieleen. Yritä hetken päästä uudelleen.') {
  if (err instanceof ApiError) return err;
  const raw = String(err?.message || err?.error_description || err || '');
  for (const [re, msg, code] of KNOWN) if (re.test(raw)) return new ApiError(msg, { cause: err, code });
  // Our own RPCs raise Finnish messages ("Liigaa ei löytynyt" etc.) — those are safe to show.
  if (/[äöå]/i.test(raw) && raw.length < 160) return new ApiError(raw, { cause: err });
  return new ApiError(fallback, { cause: err });
}

/** Throws the Supabase `{ error }` if present, otherwise returns `data`. */
export function unwrap({ data, error }, fallback) {
  if (error) throw toApiError(error, fallback);
  return data;
}
