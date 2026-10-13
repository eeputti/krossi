// constants.js — values shared by the data layer, the demo and the screens.

// Same project and publishable key as the old Koutsi and Krossi (the key is meant to be public).
export const SUPABASE_URL = 'https://hhybjpgrvlbazbqiaaao.supabase.co';
export const SUPABASE_ANON_KEY = 'sb_publishable_IKLRGbstMLfxKeXwBTavSA_UVYyMgTL';
export const KOUTSI_ORIGIN = 'https://koutsi.krossi.app';
export const SUPPORT_EMAIL = 'eelispuro@gmail.com';

// The shared profiles row asks for a home area; the list is Krossi's cities.
export const AREA_OPTIONS = ['Lahti', 'Turku', 'Helsinki', 'Tampere', 'Oulu', 'Jyväskylä', 'Pori', 'Kuopio', 'Rovaniemi', 'Mikkeli'];

// Versions of the closed-pilot acknowledgement. Must match the old app exactly, or a person who
// already confirmed there would be asked again here (and vice versa).
export const PILOT_TERMS_VERSION = '2026-08-24-optional-age';
export const PILOT_PRIVACY_VERSION = '2026-08-24-optional-age';

// koutsi_record_app_open app names — Ylläpito filters on these exact strings.
export const APP_NAME = { coach: 'koutsi_valmentaja', player: 'koutsi_pelaaja' };

export const LEVELS = ['Aloittelija', 'Keskitaso', 'Edistynyt', 'Kilpapelaaja'];
export const GROUP_LEVELS = ['Aloittelija', 'Keskitaso', 'Edistynyt', 'Kilpapelaaja', 'Kaikki tasot'];
export const WEEKDAY_CODES = ['Ma', 'Ti', 'Ke', 'To', 'Pe', 'La', 'Su'];
export const WEEKDAY_LONG = { Ma: 'maanantai', Ti: 'tiistai', Ke: 'keskiviikko', To: 'torstai', Pe: 'perjantai', La: 'lauantai', Su: 'sunnuntai' };
// What a coach can book: a group session or a private one, either can be a match instead.
export const TRAINING_TYPES = { group: ['Ryhmätreeni', 'Ottelu'], student: ['Yksityistunti', 'Ottelu'] };
export const SELF_TRAINING_TYPES = ['Omatoiminen harjoitus', 'Fysiikka', 'Muu liikunta', 'Turnaus', 'Ottelu'];
export const MOOD_LABELS = { 1: 'Raskas', 2: 'Vaisu', 3: 'Ihan ok', 4: 'Hyvä', 5: 'Loistava' };

export const FEEDBACK_CATEGORIES = [
  { id: 'ei_toimi', label: 'Jokin ei toimi' },
  { id: 'ei_tasmaa', label: 'Jokin ei täsmää' },
  { id: 'hankala_kayttaa', label: 'Jokin on hankala käyttää' },
  { id: 'toimii_hyvin', label: 'Jokin toimii tosi hyvin' },
  { id: 'muu', label: 'Muu' },
];

export const VIDEO_MAX_BYTES = 50 * 1024 * 1024;
export const VIDEO_TUS_CHUNK_BYTES = 6 * 1024 * 1024;
export const PLAN_MAX_BYTES = 20 * 1024 * 1024;
