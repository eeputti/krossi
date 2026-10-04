// constants.js — domain vocabulary shared by the data layer, the demo and the screens.
// Values are the strings stored in the database; labels are what the UI shows.

export const SUPABASE_URL = 'https://hhybjpgrvlbazbqiaaao.supabase.co';
export const SUPABASE_ANON_KEY = 'sb_publishable_IKLRGbstMLfxKeXwBTavSA_UVYyMgTL';
export const APP_ORIGIN = 'https://krossi.app';
export const PRICE_LABEL = '8,99 €';
export const SUPPORT_EMAIL = 'eelispuro@gmail.com';

export const CITIES = ['Lahti', 'Turku', 'Helsinki', 'Tampere', 'Oulu', 'Jyväskylä', 'Pori', 'Kuopio', 'Rovaniemi', 'Mikkeli'];

// Kaupunkien keskipisteet: kartan oletuskeskitys ja etäisyyksien varakoordinaatti.
export const CITY_CENTERS = {
  Lahti: [60.982628, 25.661342], Turku: [60.451593, 22.266999], Helsinki: [60.166620, 24.943541],
  Tampere: [61.497799, 23.761634], Oulu: [65.011791, 25.470197], Jyväskylä: [62.241672, 25.749581],
  Pori: [61.486613, 21.797207], Kuopio: [62.892463, 27.678360], Rovaniemi: [66.502554, 25.730391],
  Mikkeli: [61.687782, 27.273192],
};

export const INDOOR_VENUES = [
  { name: 'Janus Areena', city: 'Lahti', lat: 61.0015881, lng: 25.6970796 },
  { name: 'Kispi Areena', city: 'Lahti', lat: 60.9891361, lng: 25.6520164 },
  { name: 'Jarkko Nieminen Areena', city: 'Turku', lat: 60.4804130, lng: 22.2625180 },
  { name: 'Bo Arena', city: 'Turku', lat: 60.4136855, lng: 22.3554531 },
  // Osoite Kisakatu 2, Raisio (Kerttulan kaupunginosa)
  { name: 'Kerttulantenniskeskus', city: 'Turku', lat: 60.4935085, lng: 22.1581324 },
  { name: 'Smash Center', city: 'Helsinki', lat: 60.2097326, lng: 25.0680185 },
  { name: 'Talin Tenniskeskus', city: 'Helsinki', lat: 60.2124736, lng: 24.8743292 },
  // Avautuu Jätkäsaareen — tarkennettu kaupunginosan tasolle, päivitä kun osoite tiedossa
  { name: 'Tennis Tower Helsinki', city: 'Helsinki', lat: 60.1570639, lng: 24.9116552 },
  { name: 'Tampereen Tenniskeskus', city: 'Tampere', lat: 61.5088389, lng: 23.8447696 },
  // Liikuntakeskus Hukka, Isokatu 99, Oulu
  { name: 'Oulun Tenniskeskus', city: 'Oulu', lat: 65.0005813, lng: 25.4576478 },
  { name: 'Jyväskylän Tenniskeskus', city: 'Jyväskylä', lat: 62.2469898, lng: 25.6805365 },
  // Porin Tennishalli, Metsämiehenkatu 6, Pori
  { name: 'Porin Tenniskeskus', city: 'Pori', lat: 61.4737694, lng: 21.7710034 },
  { name: 'Kuopion Tenniskeskus', city: 'Kuopio', lat: 62.8675381, lng: 27.6371164 },
];

export const SKILL_LEVELS = [
  { value: 'aloittelija', label: 'Aloittelija', short: 'Aloittelija', desc: 'Juuri aloittamassa tai pelannut vasta muutaman kerran.' },
  { value: 'keskitaso', label: 'Keskitaso', short: 'Keskitaso', desc: 'Perusliikkeet hallussa ja pisteet pysyvät käynnissä.' },
  { value: 'edistynyt', label: 'Edistynyt', short: 'Edistynyt', desc: 'Pelaat säännöllisesti ja hallitset taktiikkaa ja eri lyöntejä.' },
  { value: 'kilpapelaaja', label: 'Kilpapelaaja', short: 'Kilpa', desc: 'Pelaat tai olet pelannut kilpaa, ja sinulla on kilpailuluokka.' },
];
export const SKILL_ORDER = SKILL_LEVELS.map((s) => s.value);
export const COMPETITION_CLASSES = ['A1', 'A2', 'A3', 'B1', 'B2', 'B3', 'C1', 'C2', 'C3', 'D1', 'D2', 'D3', 'E1', 'E2', 'E3'];

// Stored in tennis_preferences.play_style as a ", "-joined list (validated by is_valid_play_style_list).
export const PLAY_STYLES = [
  { value: 'pallottelu', label: 'Pallottelu' },
  { value: 'treenit', label: 'Treenit' },
  { value: 'matsit', label: 'Matsit' },
  { value: 'kaksinpeli', label: 'Kaksinpeli' },
  { value: 'nelinpeli', label: 'Nelinpeli' },
  { value: 'kaikki käy', label: 'Kaikki käy' },
];

export const MATCH_TYPES = [
  { value: 'kaksinpeli', label: 'Kaksinpeli', players: 2, desc: '1 vs 1' },
  { value: 'nelinpeli', label: 'Nelinpeli', players: 4, desc: '2 vs 2' },
  { value: 'pallottelu', label: 'Pallottelu', players: 2, desc: 'Rento lyöntiharjoitus' },
];
export const LOCATION_TYPES = [
  { value: 'sisätennis', label: 'Sisällä' },
  { value: 'ulkotennis', label: 'Ulkona' },
  { value: 'missä vain', label: 'Missä vain' },
];
export const COURT_SURFACES = [
  { value: 'kova', label: 'Kova' },
  { value: 'massa', label: 'Massa' },
  { value: 'nurmi', label: 'Nurmi' },
  { value: 'asfaltti', label: 'Asfaltti' },
];
export const GENDERS = [
  { value: 'mies', label: 'Mies' },
  { value: 'nainen', label: 'Nainen' },
];
export const HANDEDNESS = [
  { value: 'oikeakätinen', label: 'Oikeakätinen' },
  { value: 'vasenkätinen', label: 'Vasenkätinen' },
];
export const BACKHAND_TYPES = [
  { value: 'yhden käden', label: 'Yhden käden rysty' },
  { value: 'kahden käden', label: 'Kahden käden rysty' },
];
export const AGE_RANGES = [
  { value: 'alle20', label: 'Alle 20' },
  { value: '20-30', label: '20–30' },
  { value: '30-40', label: '30–40' },
  { value: '40-50', label: '40–50' },
  { value: '50-60', label: '50–60' },
  { value: '60+', label: '60+' },
];
export const AVAILABILITY_SLOTS = [
  { value: 'aamuvirkku', label: 'Aamuvirkku', time: '6–9' },
  { value: 'arkiaamut', label: 'Arkiaamut', time: '9–12' },
  { value: 'arkipäivät', label: 'Arkipäivät', time: '12–15' },
  { value: 'arki-iltapäivät', label: 'Arki-iltapäivät', time: '15–18' },
  { value: 'arki-illat', label: 'Arki-illat', time: '19–22' },
  { value: 'viikonloppuaamut', label: 'Viikonloppuaamut', time: '9–12' },
  { value: 'viikonloppupäivät', label: 'Viikonloppupäivät', time: '12–15' },
  { value: 'viikonloppuiltapäivät', label: 'Viikonloppuiltapäivät', time: '15–18' },
  { value: 'viikonloppuillat', label: 'Viikonloppuillat', time: '19–22' },
  { value: 'joustavasti', label: 'Joustavasti', time: '' },
];

// Haaste vanhenee feedistä tämän jälkeen sovitusta ajankohdasta; "aika avoin" -haasteet 48 h luonnista.
export const GAME_DURATION_HOURS = 3;
export const OPEN_GAME_TTL_HOURS = 48;

// Quick-create time windows for "Pelataanko?" — start hour of each window.
export const QUICK_TIME_WINDOWS = [
  { value: 'aamu', label: 'Aamu', hint: 'klo 7–10', hour: 8 },
  { value: 'paiva', label: 'Päivä', hint: 'klo 11–15', hour: 12 },
  { value: 'ilta-pv', label: 'Iltapäivä', hint: 'klo 15–18', hour: 16 },
  { value: 'ilta', label: 'Ilta', hint: 'klo 18–22', hour: 19 },
];

export const labelOf = (list, value) => list.find((x) => x.value === value)?.label ?? (value || '');
