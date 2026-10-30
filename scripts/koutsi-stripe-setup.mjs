// koutsi-stripe-setup.mjs — sets up Stripe for Koutsi's coach subscription (Profiili → Tilaus) and
// stores what the edge functions koutsi-subscription and koutsi-stripe-webhook need in Supabase.
// Run it yourself: the secret key never leaves your machine except to Stripe and Supabase.
//
//   node scripts/koutsi-stripe-setup.mjs --hinta 29
//   node scripts/koutsi-stripe-setup.mjs --hinta 29 --alku 19 --alku-kpl 10 --alku-kk 12
//   node scripts/koutsi-stripe-setup.mjs --hinta 29 --file .env.stripe-test     (Stripe's test mode first)
//   node scripts/koutsi-stripe-setup.mjs --alv 25.5     (only VAT, once Roisku Media is VAT-liable; --alv 0 = off)
//   node scripts/koutsi-stripe-setup.mjs --vuosi 290    (only the yearly price, on top of an earlier setup)
//
//   --hinta     monthly price in euros, what the coach pays (e.g. 29 or 29,90)
//   --alku …    optional founding offer: price during the first --alku-kk months for the first
//               --alku-kpl coaches (a Stripe coupon; Stripe counts the uses; monthly price only)
//   --vuosi     optional yearly price in euros (cheaper than 12 months, e.g. 290): KOUTSI_PRICE_YEAR_ID,
//               and the customer portal lets a coach switch between month and year. Without --hinta it
//               touches nothing else (the monthly price and portal come from the env file).
//   --file      env file with the secret key (default .env.stripe, gitignored): KOUTSI_STRIPE_SECRET_KEY,
//               else STRIPE_SECRET_KEY (Krossi's — same Stripe account, Roisku Media)
//   --alv       VAT in percent added on top of the price (tilausehdot §3): a Stripe tax rate for new
//               subscriptions (KOUTSI_TAX_RATE), and — after a yes, once the coaches have had 30 days'
//               notice — for the current ones from their next charge. --alv 0 takes it off. Alone it
//               touches nothing else; without --alv nothing about VAT changes.
//
// What it does, in the mode of the key (test or live). Running it again is safe: what exists is reused.
//   1. checks the key with Stripe
//   2. product "Krossi Koutsi" + the monthly price (a new price only when the amount is new; coaches
//      already subscribed keep theirs)
//   3. the founding offer coupon, when asked
//   4. the webhook endpoint for supabase/functions/koutsi-stripe-webhook (its own secret; Krossi's
//      endpoint and stripe-webhook are not touched)
//   5. the customer portal (card, receipts, cancel at the period's end)
//   6. stores KOUTSI_STRIPE_SECRET_KEY / _PRICE_ID / _STRIPE_WEBHOOK_SECRET / _PORTAL_CONFIG /
//      _FOUNDER_COUPON in Supabase (Edge Function secrets) and in the env file
// It does not deploy the functions or run the migration; it prints those commands at the end.

import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import readline from 'node:readline';

const PROJECT_REF = 'hhybjpgrvlbazbqiaaao';
const WEBHOOK_URL = `https://${PROJECT_REF}.supabase.co/functions/v1/koutsi-stripe-webhook`;
const WEBHOOK_EVENTS = ['checkout.session.completed', 'customer.subscription.created', 'customer.subscription.updated', 'customer.subscription.deleted'];
const PRODUCT_ID = 'krossi_koutsi_valmentaja';
const TRIAL_MONTHS = 3; // koutsi_start_trial: now() + interval '3 months'
const APP = 'https://koutsi.krossi.app';

const ok = (msg) => console.log(`  ✅ ${msg}`);
const warn = (msg) => console.log(`  ⚠️  ${msg}`);
const fail = (msg) => { console.log(`\n  ❌ ${msg}\n`); process.exit(1); };
const step = (msg) => console.log(`\n${msg}`);
const mask = (key) => (key ? `${key.slice(0, 8)}…${key.slice(-4)}` : '—');

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : undefined;
}
function euros(value, name) {
  if (value === undefined) return null;
  const n = Number(String(value).replace(',', '.'));
  if (!Number.isFinite(n) || n <= 0 || n > 1000) fail(`--${name} pitää olla euromäärä, esim. 29 tai 29,90.`);
  return Math.round(n * 100);
}

const ENV_FILE = arg('file') || '.env.stripe';
const PRICE_CENTS = euros(arg('hinta'), 'hinta');
const OFFER_CENTS = euros(arg('alku'), 'alku');
const OFFER_COUNT = arg('alku-kpl') === undefined ? null : Number(arg('alku-kpl'));
const OFFER_MONTHS = arg('alku-kk') === undefined ? null : Number(arg('alku-kk'));
const YEAR_CENTS = (() => {
  const v = arg('vuosi');
  if (v === undefined) return null;
  const n = Number(String(v).replace(',', '.'));
  if (!Number.isFinite(n) || n <= 0 || n > 10000) { console.log('\n  ❌ --vuosi pitää olla euromäärä, esim. 290.\n'); process.exit(1); }
  return Math.round(n * 100);
})();
const VAT = arg('alv') === undefined ? undefined : Number(String(arg('alv')).replace(',', '.'));
if (VAT !== undefined && !(VAT >= 0 && VAT < 50)) {
  console.log('\n  ❌ --alv pitää olla prosentti, esim. 25.5 (tai 0 = pois).\n');
  process.exit(1);
}

function readEnv(path) {
  const env = {};
  if (!existsSync(path)) return env;
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (m && !line.trimStart().startsWith('#')) env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2').trim();
  }
  return env;
}
function writeEnv(path, values) {
  let text = existsSync(path) ? readFileSync(path, 'utf8') : '# Stripe-avaimet (gitignoressa, älä commitoi).\n';
  for (const [name, value] of Object.entries(values)) {
    const re = new RegExp(`^\\s*${name}\\s*=.*$`, 'm');
    text = re.test(text) ? text.replace(re, `${name}=${value}`) : `${text.replace(/\n?$/, '\n')}${name}=${value}\n`;
  }
  writeFileSync(path, text, { mode: 0o600 });
}

async function stripe(key, method, path, params = []) {
  const query = new URLSearchParams(params).toString();
  const res = await fetch(`https://api.stripe.com/v1/${path}${method !== 'POST' && query ? `?${query}` : ''}`, {
    method,
    headers: { Authorization: `Bearer ${key}`, ...(method === 'POST' ? { 'content-type': 'application/x-www-form-urlencoded' } : {}) },
    body: method === 'POST' ? query : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error?.message || `${res.status} ${res.statusText}`), { status: res.status, code: data.error?.code });
  return data;
}
const modeOf = (key) => /^[sr]k_(test|live)_[A-Za-z0-9]{20,}$/.exec(key || '')?.[1] || null;

function confirm(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl.question(question, (answer) => { rl.close(); resolve(/^(kyllä|kylla|k|yes|y)$/i.test(answer.trim())); });
  });
}

// The coaches' live Koutsi subscriptions (all of them: Stripe pages by 100).
async function liveKoutsiSubscriptions(key) {
  const out = [];
  for (const status of ['active', 'trialing', 'past_due']) {
    let after = null;
    for (;;) {
      const page = await stripe(key, 'GET', 'subscriptions', [['status', status], ['limit', '100'], ...(after ? [['starting_after', after]] : [])]);
      out.push(...page.data.filter((sub) => sub.metadata?.product === 'koutsi_subscription'));
      if (!page.has_more || !page.data.length) break;
      after = page.data[page.data.length - 1].id;
    }
  }
  return out;
}

// VAT on top of the price (tilausehdot §3) or off again. → the KOUTSI_TAX_RATE id, or '' when off.
async function vatStep(key) {
  if (VAT > 0) {
    let rate = (await stripe(key, 'GET', 'tax_rates', [['active', 'true'], ['inclusive', 'false'], ['limit', '100']])).data
      .find((r) => r.metadata?.koutsi === '1' && Number(r.percentage) === VAT);
    if (rate) ok(`Alv-kanta löytyi (${VAT} %, ${rate.id})`);
    else {
      rate = await stripe(key, 'POST', 'tax_rates', [
        ['display_name', 'ALV'], ['percentage', String(VAT)], ['inclusive', 'false'], ['country', 'FI'],
        ['jurisdiction', 'Suomi'], ['description', 'Koutsi-tilauksen arvonlisävero'], ['metadata[koutsi]', '1'],
      ]);
      ok(`Luotiin alv-kanta ${VAT} % (${rate.id}): uudet tilaukset saavat sen heti`);
    }
    const todo = (await liveKoutsiSubscriptions(key)).filter((sub) => !(sub.default_tax_rates || []).some((r) => r.id === rate.id));
    if (!todo.length) ok('Nykyisissä tilauksissa ei ole lisättävää');
    else if (await confirm(`     Lisätäänkö alv myös ${todo.length} nykyiseen tilaukseen seuraavasta veloituksesta alkaen?\n     Valmentajille pitää ilmoittaa vähintään 30 päivää etukäteen (tilausehdot §3). Kirjoita "kyllä": `)) {
      for (const sub of todo) await stripe(key, 'POST', `subscriptions/${sub.id}`, [['default_tax_rates[]', rate.id], ['proration_behavior', 'none']]);
      ok(`Alv lisätty ${todo.length} tilaukseen`);
    } else warn(`Nykyiset ${todo.length} tilausta jatkavat ilman alv:a. Aja komento uudelleen, kun ilmoitusaika on kulunut.`);
    warn('Stripessä käsin: Settings → Business → Tax details: ALV-tunnus FI34134066 laskuille, ja poista laskupohjan alatunniste "Ei arvonlisäverovelvollinen (AVL 3 §)".');
    return rate.id;
  }
  const taxed = (await liveKoutsiSubscriptions(key)).filter((sub) => (sub.default_tax_rates || []).length);
  if (taxed.length && await confirm(`     Poistetaanko alv myös ${taxed.length} nykyisestä tilauksesta? Kirjoita "kyllä": `)) {
    for (const sub of taxed) await stripe(key, 'POST', `subscriptions/${sub.id}`, [['default_tax_rates', ''], ['proration_behavior', 'none']]);
    ok(`Alv poistettu ${taxed.length} tilauksesta`);
  }
  ok('Uudet tilaukset ilman alv:a (KOUTSI_TAX_RATE poistetaan)');
  return '';
}

// The yearly price (found by its lookup key, else made).
async function yearPrice(key) {
  const lookup = `koutsi_v_${YEAR_CENTS}`;
  let price = (await stripe(key, 'GET', 'prices', [['lookup_keys[]', lookup], ['active', 'true'], ['limit', '1']])).data[0];
  if (price) ok(`Vuosihinta löytyi (${price.id})`);
  else {
    price = await stripe(key, 'POST', 'prices', [
      ['product', PRODUCT_ID], ['currency', 'eur'], ['unit_amount', String(YEAR_CENTS)], ['recurring[interval]', 'year'],
      ['lookup_key', lookup], ['nickname', 'Koutsi / vuosi'],
    ]);
    ok(`Luotiin vuosihinta ${(YEAR_CENTS / 100).toFixed(2).replace('.', ',')} € (${price.id})`);
  }
  return price;
}

// The portal lets a coach switch between month and year (prorated) once both prices exist.
const switchParams = (monthId, yearId) => [
  ['features[subscription_update][enabled]', 'true'],
  ['features[subscription_update][default_allowed_updates][]', 'price'],
  ['features[subscription_update][proration_behavior]', 'create_prorations'],
  ['features[subscription_update][products][0][product]', PRODUCT_ID],
  ['features[subscription_update][products][0][prices][]', monthId],
  ['features[subscription_update][products][0][prices][]', yearId],
];

function supabaseSecrets(args) {
  const res = spawnSync('supabase', [...args, '--project-ref', PROJECT_REF], { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' });
  if (res.status !== 0) fail(`Supabase-tallennus epäonnistui:\n${res.stderr || res.stdout}`);
}

async function main() {
  console.log('\nKrossi Koutsi × Stripe — valmentajan tilaus\n');
  const vatOnly = !PRICE_CENTS && (VAT !== undefined || YEAR_CENTS !== null);
  if (!PRICE_CENTS && !vatOnly) fail('Anna kuukausihinta: --hinta 29 (tai pelkkä alv: --alv 25.5, pelkkä vuosihinta: --vuosi 290)');
  const offer = OFFER_CENTS !== null;
  if (offer && (OFFER_CENTS >= PRICE_CENTS || !(OFFER_COUNT > 0) || !(OFFER_MONTHS > 0))) {
    fail('Aloitustarjous tarvitsee --alku (pienempi kuin --hinta), --alku-kpl ja --alku-kk, esim. --alku 19 --alku-kpl 10 --alku-kk 12.');
  }
  const env = readEnv(ENV_FILE);
  const secret = env.KOUTSI_STRIPE_SECRET_KEY || env.STRIPE_SECRET_KEY || '';

  step('1/6  Avain');
  if (!modeOf(secret)) fail(`Tiedostosta ${ENV_FILE} ei löytynyt Stripen secret keytä (KOUTSI_STRIPE_SECRET_KEY tai STRIPE_SECRET_KEY, sk_live_… / sk_test_…).`);
  const mode = modeOf(secret);
  const account = await stripe(secret, 'GET', 'account').catch((err) => fail(`Stripe ei hyväksynyt avainta: ${err.message}`));
  ok(`Avain toimii (${mask(secret)}, ${mode === 'live' ? 'LIVE — oikeat maksut' : 'testitila'}), ${account.settings?.dashboard?.display_name || account.business_profile?.name || account.id}`);

  if (vatOnly && YEAR_CENTS !== null) {
    step('Vuosihinta');
    if (!env.KOUTSI_PRICE_ID || !env.KOUTSI_PORTAL_CONFIG) fail(`Tiedostosta ${ENV_FILE} puuttuu KOUTSI_PRICE_ID tai KOUTSI_PORTAL_CONFIG: aja ensin koko asennus (--hinta …).`);
    const year = await yearPrice(secret);
    await stripe(secret, 'POST', `billing_portal/configurations/${env.KOUTSI_PORTAL_CONFIG}`, switchParams(env.KOUTSI_PRICE_ID, year.id));
    ok('Asiakasportaalissa voi vaihtaa kuukauden ja vuoden välillä');
    supabaseSecrets(['secrets', 'set', `KOUTSI_PRICE_YEAR_ID=${year.id}`]);
    writeEnv(ENV_FILE, { KOUTSI_PRICE_YEAR_ID: year.id });
    ok('KOUTSI_PRICE_YEAR_ID tallennettu Supabaseen: Ota tilaus kysyy kuukausi vai vuosi');
    if (VAT === undefined) { console.log('\n🎾 Valmis.\n'); return; }
  }
  if (vatOnly) {
    step('Arvonlisävero');
    const rateId = await vatStep(secret);
    if (rateId) supabaseSecrets(['secrets', 'set', `KOUTSI_TAX_RATE=${rateId}`]);
    else spawnSync('supabase', ['secrets', 'unset', 'KOUTSI_TAX_RATE', '--project-ref', PROJECT_REF], { stdio: 'ignore' });
    writeEnv(ENV_FILE, { KOUTSI_TAX_RATE: rateId });
    ok(rateId ? 'KOUTSI_TAX_RATE tallennettu Supabaseen: Koutsi näyttää hinnan muodossa "29 €/kk + alv"' : 'Tallennettu');
    console.log('\n🎾 Valmis.\n');
    return;
  }

  step('2/6  Tuote ja kuukausihinta');
  let product = await stripe(secret, 'GET', `products/${PRODUCT_ID}`).catch(() => null);
  if (!product) {
    product = await stripe(secret, 'POST', 'products', [['id', PRODUCT_ID], ['name', 'Krossi Koutsi'], ['description', 'Valmentajan kuukausitilaus']]);
    ok('Luotiin tuote "Krossi Koutsi"');
  } else ok('Tuote "Krossi Koutsi" löytyi');
  const lookup = `koutsi_kk_${PRICE_CENTS}`;
  let price = (await stripe(secret, 'GET', 'prices', [['lookup_keys[]', lookup], ['active', 'true'], ['limit', '1']])).data[0];
  if (price) ok(`Hinta löytyi (${price.id})`);
  else {
    price = await stripe(secret, 'POST', 'prices', [
      ['product', PRODUCT_ID], ['currency', 'eur'], ['unit_amount', String(PRICE_CENTS)], ['recurring[interval]', 'month'],
      ['lookup_key', lookup], ['nickname', 'Koutsi / kk'],
    ]);
    ok(`Luotiin kuukausihinta ${(PRICE_CENTS / 100).toFixed(2).replace('.', ',')} € (${price.id})`);
  }

  step('3/6  Aloitustarjous');
  let coupon = '';
  if (!offer) ok('Ei aloitustarjousta (KOUTSI_FOUNDER_COUPON poistetaan)');
  else {
    const off = PRICE_CENTS - OFFER_CENTS;
    // Stripe counts a coupon's months from the day the subscription is made, also inside the free
    // trial (the first charge comes at its end). The coupon lasts the trial's 3 months longer, so
    // every coach gets at least --alku-kk paid months at the offer price; the app shows --alku-kk
    // (metadata koutsi_kk).
    const months = OFFER_MONTHS + TRIAL_MONTHS;
    coupon = `KOUTSI_ALKU_${off}_${OFFER_MONTHS}KK_${OFFER_COUNT}`;
    const found = await stripe(secret, 'GET', `coupons/${coupon}`).catch(() => null);
    if (found) ok(`Kuponki löytyi (${coupon}, käytetty ${found.times_redeemed}/${found.max_redemptions})`);
    else {
      await stripe(secret, 'POST', 'coupons', [
        ['id', coupon], ['name', 'Koutsi aloitustarjous'], ['currency', 'eur'], ['amount_off', String(off)],
        ['duration', 'repeating'], ['duration_in_months', String(months)], ['max_redemptions', String(OFFER_COUNT)],
        ['applies_to[products][]', PRODUCT_ID], ['metadata[koutsi_kk]', String(OFFER_MONTHS)],
      ]);
      ok(`Luotiin aloitustarjous: ${OFFER_CENTS / 100} €/kk ${OFFER_MONTHS} kk, ${OFFER_COUNT} ensimmäiselle (${coupon})`);
    }
  }

  step('4/6  Webhook (Stripe → Koutsin tilaus)');
  let webhookSecret = env.KOUTSI_STRIPE_WEBHOOK_SECRET && modeOf(env.KOUTSI_STRIPE_SECRET_KEY) === mode ? env.KOUTSI_STRIPE_WEBHOOK_SECRET : '';
  const hooks = (await stripe(secret, 'GET', 'webhook_endpoints', [['limit', '100']])).data.filter((h) => h.url === WEBHOOK_URL);
  if (hooks.length && webhookSecret.startsWith('whsec_')) {
    await stripe(secret, 'POST', `webhook_endpoints/${hooks[0].id}`, WEBHOOK_EVENTS.map((e) => ['enabled_events[]', e]));
    ok('Webhook löytyi, tapahtumat tarkistettu');
  } else {
    // Stripe shows the signing secret only when the endpoint is created.
    for (const hook of hooks) await stripe(secret, 'DELETE', `webhook_endpoints/${hook.id}`);
    const hook = await stripe(secret, 'POST', 'webhook_endpoints', [
      ['url', WEBHOOK_URL], ['description', 'Krossi Koutsi: valmentajan tilaus → Supabase (koutsi-stripe-webhook)'],
      ...WEBHOOK_EVENTS.map((e) => ['enabled_events[]', e]),
    ]);
    webhookSecret = hook.secret;
    ok(hooks.length ? 'Webhook luotiin uudelleen (vanhan salaisuus ei ollut tiedossa)' : 'Webhook luotiin');
  }

  let year = null;
  if (YEAR_CENTS !== null) {
    step('Vuosihinta');
    year = await yearPrice(secret);
  }

  step('5/6  Asiakasportaali (kortti, kuitit, peruminen)');
  let portal = env.KOUTSI_PORTAL_CONFIG && modeOf(env.KOUTSI_STRIPE_SECRET_KEY) === mode
    ? await stripe(secret, 'GET', `billing_portal/configurations/${env.KOUTSI_PORTAL_CONFIG}`).catch(() => null) : null;
  const portalParams = [
    ['business_profile[headline]', 'Krossi Koutsi — tilauksesi'],
    ['business_profile[privacy_policy_url]', `${APP}/tietosuoja`],
    ['business_profile[terms_of_service_url]', `${APP}/tilausehdot`],
    ['default_return_url', `${APP}/valmentaja/profiili`],
    ['features[customer_update][enabled]', 'true'],
    ['features[customer_update][allowed_updates][]', 'email'],
    ['features[customer_update][allowed_updates][]', 'address'],
    ['features[customer_update][allowed_updates][]', 'tax_id'],
    ['features[invoice_history][enabled]', 'true'],
    ['features[payment_method_update][enabled]', 'true'],
    ['features[subscription_cancel][enabled]', 'true'],
    ['features[subscription_cancel][mode]', 'at_period_end'],
    ...(year ? switchParams(price.id, year.id) : []),
  ];
  if (portal?.active) {
    await stripe(secret, 'POST', `billing_portal/configurations/${portal.id}`, portalParams);
    ok(`Portaali päivitetty (${portal.id})`);
  } else {
    portal = await stripe(secret, 'POST', 'billing_portal/configurations', portalParams);
    ok(`Portaali luotiin (${portal.id})`);
  }

  let taxRate;
  if (VAT !== undefined) {
    step('Arvonlisävero');
    taxRate = await vatStep(secret);
    if (!taxRate) spawnSync('supabase', ['secrets', 'unset', 'KOUTSI_TAX_RATE', '--project-ref', PROJECT_REF], { stdio: 'ignore' });
  }

  step('6/6  Tallennus Supabaseen');
  const values = {
    KOUTSI_STRIPE_SECRET_KEY: secret,
    KOUTSI_PRICE_ID: price.id,
    KOUTSI_STRIPE_WEBHOOK_SECRET: webhookSecret,
    KOUTSI_PORTAL_CONFIG: portal.id,
    ...(coupon ? { KOUTSI_FOUNDER_COUPON: coupon } : {}),
    ...(taxRate ? { KOUTSI_TAX_RATE: taxRate } : {}),
    ...(year ? { KOUTSI_PRICE_YEAR_ID: year.id } : {}),
  };
  const dir = mkdtempSync(join(tmpdir(), 'koutsi-stripe-'));
  const tmp = join(dir, 'secrets.env');
  try {
    writeFileSync(tmp, Object.entries(values).map(([k, v]) => `${k}=${v}`).join('\n') + '\n', { mode: 0o600 });
    chmodSync(tmp, 0o600);
    supabaseSecrets(['secrets', 'set', '--env-file', tmp]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  if (!coupon) spawnSync('supabase', ['secrets', 'unset', 'KOUTSI_FOUNDER_COUPON', '--project-ref', PROJECT_REF], { stdio: 'ignore' });
  ok(`${Object.keys(values).join(', ')} tallennettu Supabaseen`);
  writeEnv(ENV_FILE, values);
  ok(`Samat arvot tiedostoon ${ENV_FILE} (gitignoressa)`);

  console.log(`
Seuraavaksi (vain jos et ole jo tehnyt):
  supabase functions deploy koutsi-subscription --project-ref ${PROJECT_REF}
  supabase functions deploy koutsi-stripe-webhook --no-verify-jwt --project-ref ${PROJECT_REF}
Stripessä käsin (Settings): Customer emails → kuitit ja laskut päälle; Billing → Subscriptions →
epäonnistuneiden maksujen uusintayritykset ja niiden jälkeen "cancel subscription"; Billing → Invoice
template → alatunniste "Ei arvonlisäverovelvollinen (AVL 3 §)" niin kauan kuin Roisku Media ei ole alv-rekisterissä.

🎾 Valmis${mode === 'live' ? ' — Koutsin tilaus on nyt oikeasti maksettavissa' : ' (testitila: kortti 4242 4242 4242 4242)'}.
`);
}

main().catch((err) => fail(err.message));
