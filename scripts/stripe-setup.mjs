// stripe-setup.mjs — sets up Stripe for Krossi's checkout in one go and stores the keys in
// Supabase. Run it yourself (the keys never leave your machine except to Stripe and Supabase):
//
//   npm run stripe:setup                (reads .env.stripe, asks for anything missing)
//   node scripts/stripe-setup.mjs --file other.env
//
// What it does, in whichever mode the secret key is from (test or live):
//   1. checks the secret + publishable keys with Stripe (catches pk/sk mix-ups and masked keys)
//   2. finds or creates the 8,99 € one-time price (lookup key krossi_unlock_899)
//   3. finds or creates the webhook endpoint for supabase/functions/stripe-webhook
//   4. turns on MobilePay, Apple Pay and Google Pay and registers krossi.app for the wallets
//   5. stores STRIPE_SECRET_KEY / _PUBLISHABLE_KEY / _PRICE_ID / _WEBHOOK_SECRET in Supabase
//      and writes them back to .env.stripe (gitignored)
// Running it again is safe: everything that already exists is reused.

import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import readline from 'node:readline';

const PROJECT_REF = 'hhybjpgrvlbazbqiaaao';
const WEBHOOK_URL = `https://${PROJECT_REF}.supabase.co/functions/v1/stripe-webhook`;
const WEBHOOK_EVENTS = ['checkout.session.completed', 'payment_intent.succeeded'];
const PRICE_LOOKUP_KEY = 'krossi_unlock_899';
const DOMAINS = ['krossi.app', 'www.krossi.app'];

const fileArg = process.argv.indexOf('--file');
const ENV_FILE = fileArg > -1 ? process.argv[fileArg + 1] : '.env.stripe';

const ok = (msg) => console.log(`  ✅ ${msg}`);
const warn = (msg) => console.log(`  ⚠️  ${msg}`);
const fail = (msg) => { console.log(`\n  ❌ ${msg}\n`); process.exit(1); };
const step = (msg) => console.log(`\n${msg}`);
const mask = (key) => (key ? `${key.slice(0, 8)}…${key.slice(-4)}` : '—');

// ── .env file ────────────────────────────────────────────────────────────────
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
  let text = existsSync(path) ? readFileSync(path, 'utf8') : '# Krossin Stripe-avaimet (gitignoressa, älä commitoi).\n';
  for (const [name, value] of Object.entries(values)) {
    const re = new RegExp(`^\\s*${name}\\s*=.*$`, 'm');
    text = re.test(text) ? text.replace(re, `${name}=${value}`) : `${text.replace(/\n?$/, '\n')}${name}=${value}\n`;
  }
  writeFileSync(path, text, { mode: 0o600 });
}

// ── prompts ──────────────────────────────────────────────────────────────────
function ask(question, { hidden = false } = {}) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    // Hidden: keep the prompt, echo nothing of what's pasted, then confirm with the masked key.
    if (hidden) {
      rl._writeToOutput = (s) => {
        if (s.startsWith(question)) rl.output.write(question);
        else if (/[\r\n]/.test(s)) rl.output.write('\n');
      };
    }
    rl.question(question, (answer) => {
      rl.close();
      const value = answer.trim();
      if (hidden) console.log(`     (vastaanotettu: ${mask(value)}, ${value.length} merkkiä)`);
      resolve(value);
    });
  });
}

// ── Stripe API ───────────────────────────────────────────────────────────────
async function stripe(key, method, path, params = []) {
  const query = new URLSearchParams(params).toString();
  const res = await fetch(`https://api.stripe.com/v1/${path}${method === 'GET' && query ? `?${query}` : ''}`, {
    method,
    headers: { Authorization: `Bearer ${key}`, ...(method === 'POST' ? { 'content-type': 'application/x-www-form-urlencoded' } : {}) },
    body: method === 'POST' ? query : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error?.message || `${res.status} ${res.statusText}`), { status: res.status, code: data.error?.code });
  return data;
}

// ── keys ─────────────────────────────────────────────────────────────────────
const modeOf = (key, kind) => new RegExp(`^${kind}_(test|live)_[A-Za-z0-9]{20,}$`).exec(key || '')?.[1] || null;

/** Why this doesn't look like a usable secret key, or null if it does. */
function secretKeyProblem(secret, publishable) {
  if (!secret) return 'Secret key puuttuu.';
  if (/\.\.\.|…/.test(secret)) return 'Tämä on Stripen piilotettu näkymä (kolme pistettä), ei koko avain. Klikkaa Stripessä "Reveal live key" ja kopioi koko avain.';
  if (secret.startsWith('pk_')) return 'Tämä on Publishable key. Tarvitaan rivin "Secret key" avain (alkaa sk_live_ tai sk_test_).';
  if (publishable && secret.replace(/^[sr]k_/, '') === publishable.replace(/^pk_/, '')) {
    return 'Tämä on Publishable key, jonka alku on vaihdettu sk_:ksi. Secret key on kokonaan eri merkkijono: Stripe → Developers → API keys → Secret key → "Reveal live key".';
  }
  if (!modeOf(secret, '(?:sk|rk)')) return 'Ei näytä Stripen secret keyltä (pitäisi alkaa sk_live_ tai sk_test_ ja olla pitkä).';
  return null;
}

async function main() {
  console.log('\nKrossi × Stripe — asennus\n');
  const env = readEnv(ENV_FILE);
  let secret = env.STRIPE_SECRET_KEY || '';
  let publishable = env.STRIPE_PUBLISHABLE_KEY || '';

  step('1/5  Avaimet');
  for (let tries = 0; ; tries += 1) {
    const problem = secretKeyProblem(secret, publishable);
    let account = null;
    if (!problem) {
      try {
        account = await stripe(secret, 'GET', 'account');
      } catch (err) {
        if (err.status !== 401) fail(`Stripe ei vastannut: ${err.message}`);
      }
    }
    if (account) {
      ok(`Secret key toimii (${mask(secret)}, ${modeOf(secret, '(?:sk|rk)') === 'live' ? 'LIVE — oikeat maksut' : 'testitila'})`);
      if (!account.charges_enabled) warn('Stripe-tiliä ei ole vielä aktivoitu ottamaan maksuja vastaan. Viimeistele se Stripessä: Settings → Account details / "Activate payments".');
      else ok(`Tili voi ottaa maksuja vastaan (${account.settings?.dashboard?.display_name || account.business_profile?.name || account.id})`);
      break;
    }
    if (tries >= 3) fail('Secret key ei kelpaa. Hae se Stripestä: Developers → API keys → Secret key → "Reveal live key" (tai "Create secret key").');
    console.log(`  ❌ ${problem || 'Stripe ei hyväksy tätä avainta (Invalid API Key). Kopioi se uudelleen Stripestä.'}`);
    secret = await ask('     Liitä Secret key (sk_live_… / sk_test_…) ja paina Enter: ', { hidden: true });
  }
  const mode = modeOf(secret, '(?:sk|rk)');

  while (modeOf(publishable, 'pk') !== mode) {
    console.log(modeOf(publishable, 'pk')
      ? `  ❌ Publishable key on ${modeOf(publishable, 'pk')}-tilasta, secret key ${mode}-tilasta. Molempien pitää olla samasta.`
      : '  ❌ Publishable key puuttuu tai ei ole muotoa pk_live_… / pk_test_….');
    publishable = await ask(`     Liitä Publishable key (pk_${mode}_…) ja paina Enter: `);
  }
  ok(`Publishable key (${mask(publishable)})`);

  step('2/5  Hinta 8,99 € (kertamaksu)');
  const found = await stripe(secret, 'GET', 'prices', [['lookup_keys[]', PRICE_LOOKUP_KEY], ['active', 'true'], ['limit', '1']]);
  let price = found.data[0];
  if (price) ok(`Hinta löytyi jo (${price.id})`);
  else {
    price = await stripe(secret, 'POST', 'prices', [
      ['currency', 'eur'], ['unit_amount', '899'], ['lookup_key', PRICE_LOOKUP_KEY],
      ['product_data[name]', 'Krossi — kertamaksu'],
    ]);
    ok(`Luotiin tuote "Krossi — kertamaksu" ja hinta 8,99 € (${price.id})`);
  }

  step('3/5  Webhook (maksu → Krossi aukeaa)');
  let webhookSecret = env.STRIPE_WEBHOOK_SECRET && modeOf(secret, '(?:sk|rk)') === modeOf(env.STRIPE_SECRET_KEY, '(?:sk|rk)') ? env.STRIPE_WEBHOOK_SECRET : '';
  const hooks = (await stripe(secret, 'GET', 'webhook_endpoints', [['limit', '100']])).data.filter((h) => h.url === WEBHOOK_URL);
  if (hooks.length && webhookSecret.startsWith('whsec_')) {
    const events = [...new Set([...hooks[0].enabled_events, ...WEBHOOK_EVENTS])];
    await stripe(secret, 'POST', `webhook_endpoints/${hooks[0].id}`, events.map((e) => ['enabled_events[]', e]));
    ok('Webhook löytyi jo, tapahtumat tarkistettu');
  } else {
    // Stripe shows a signing secret only when the endpoint is created: an old endpoint whose
    // secret we don't have is replaced so Supabase gets a secret that matches.
    for (const hook of hooks) await stripe(secret, 'DELETE', `webhook_endpoints/${hook.id}`);
    const hook = await stripe(secret, 'POST', 'webhook_endpoints', [
      ['url', WEBHOOK_URL], ['description', 'Krossi: maksut → Supabase (stripe-webhook)'],
      ...WEBHOOK_EVENTS.map((e) => ['enabled_events[]', e]),
    ]);
    webhookSecret = hook.secret;
    ok(hooks.length ? 'Webhook luotiin uudelleen (vanhan salaisuus ei ollut tiedossa)' : 'Webhook luotiin');
  }

  step('4/5  Maksutavat');
  try {
    const configs = (await stripe(secret, 'GET', 'payment_method_configurations', [['limit', '20']])).data;
    const config = configs.find((c) => c.is_default && !c.application) || configs.find((c) => !c.application);
    if (!config) warn('Maksutapa-asetuksia ei löytynyt — tarkista Stripe → Settings → Payment methods.');
    else {
      for (const method of ['mobilepay', 'apple_pay', 'google_pay']) {
        try { await stripe(secret, 'POST', `payment_method_configurations/${config.id}`, [[`${method}[display_preference][preference]`, 'on']]); } catch { /* reported below */ }
      }
      const fresh = await stripe(secret, 'GET', `payment_method_configurations/${config.id}`);
      for (const [method, label] of [['card', 'Kortti'], ['mobilepay', 'MobilePay'], ['apple_pay', 'Apple Pay'], ['google_pay', 'Google Pay']]) {
        const m = fresh[method];
        if (m?.available) ok(`${label} päällä`);
        else warn(`${label} ei ole vielä käytössä (${m?.display_preference?.value === 'on' ? 'kytketty päälle, Stripe ei ole vielä hyväksynyt tilille' : 'ei saatavilla tilille'}) — katso Stripe → Settings → Payment methods.`);
      }
    }
  } catch (err) {
    warn(`Maksutapojen kytkentä ei onnistunut (${err.message}). Kytke MobilePay käsin: Stripe → Settings → Payment methods.`);
  }
  for (const domain of DOMAINS) {
    try {
      const existing = (await stripe(secret, 'GET', 'payment_method_domains', [['domain_name', domain]])).data[0];
      const d = existing || await stripe(secret, 'POST', 'payment_method_domains', [['domain_name', domain]]);
      ok(`${domain} rekisteröity lompakoille (Apple Pay: ${d.apple_pay?.status || '?'}, Google Pay: ${d.google_pay?.status || '?'})`);
    } catch (err) {
      warn(`${domain}: domainin rekisteröinti ei onnistunut (${err.message}). Krossi yrittää sitä itse myöhemmin.`);
    }
  }

  step('5/5  Tallennus Supabaseen');
  const values = {
    STRIPE_SECRET_KEY: secret,
    STRIPE_PUBLISHABLE_KEY: publishable,
    STRIPE_PRICE_ID: price.id,
    STRIPE_WEBHOOK_SECRET: webhookSecret,
  };
  const dir = mkdtempSync(join(tmpdir(), 'krossi-stripe-'));
  const tmp = join(dir, 'secrets.env');
  try {
    writeFileSync(tmp, Object.entries(values).map(([k, v]) => `${k}=${v}`).join('\n') + '\n', { mode: 0o600 });
    chmodSync(tmp, 0o600);
    const res = spawnSync('supabase', ['secrets', 'set', '--env-file', tmp, '--project-ref', PROJECT_REF], { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' });
    if (res.status !== 0) fail(`Supabase-tallennus epäonnistui:\n${res.stderr || res.stdout}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  ok('STRIPE_SECRET_KEY, STRIPE_PUBLISHABLE_KEY, STRIPE_PRICE_ID ja STRIPE_WEBHOOK_SECRET tallennettu Supabaseen');
  writeEnv(ENV_FILE, values);
  ok(`Samat arvot tallennettu tiedostoon ${ENV_FILE} (gitignoressa)`);

  console.log(`\n🎾 Valmis${mode === 'live' ? ' — Krossissa voi nyt maksaa oikeasti' : ' (testitila)'}. Kerro Claudelle "valmis", niin se tarkistaa vielä kaiken.\n`);
}

main().catch((err) => fail(err.message));
