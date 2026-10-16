// booking-split-resale.mjs — phone-emulated end-to-end run of court booking phase 4 in the demo:
// jaettu maksu (book a nelinpeli split with three pelikaverit, the friends are asked in their chats,
// two of them pay), the friend's side (pay Mikko's request from the chat), the rest a declined
// card left, and "Laita myyntiin" (sell a booking past its free cancellation; somebody books it).
// Uses the build in <out>/site from snap.mjs; takes about a minute (the demo's friends and buyer
// answer after a few seconds, the screens look again every 15 s).
//
//   node krossi/web/scripts/snap.mjs --out /tmp/x /demo/varaa   (builds <out>/site once)
//   node krossi/web/test/e2e/booking-split-resale.mjs /tmp/x
import { startHarness } from './harness.mjs';

const h = await startHarness(process.argv[2], { name: 'booking-split-resale' });
const page = await h.phone();
const text = (selector) => page.$$eval(selector, (els) => els.map((e) => e.innerText.replace(/\s+/g, ' ').trim()));
const dialog = () => page.$eval('.sheet-root:not(.is-closing) .sheet', (e) => e.innerText.replace(/\s+/g, ' ').trim()).catch(() => '');
const toasts = async () => (await h.state(page)).toasts;

await page.goto(h.url('/demo/varaa'), { waitUntil: 'networkidle0' });
await h.wait(900);
h.check('one row says payments are waiting', (await text('.bk-unpaid-row'))[0]?.includes('Maksamattomat maksut'), await text('.bk-unpaid-row'));
await h.tapText(page, 'Maksamattomat maksut', { selector: '.bk-unpaid-row' });
await h.wait(900);
const owe = await text('.bk-owe');
h.check('its sheet lists them', owe.some((t) => t.includes('Mikko pyytää osuuttasi')) && owe.some((t) => t.includes('Loppuosuus maksamatta')), owe);
await h.tapText(page, 'Sulje', { selector: '.sheet-close-floating' });
await h.wait(700);
h.check('somebody\'s slot on sale is a row among the times', (await text('.bk-time.is-sale')).length === 1, await text('.bk-time.is-sale'));

// ── Jaettu maksu: a nelinpeli tomorrow at 19 with Mikko, Laura and Ville ──
// The day strip glides to today on load: tap tomorrow until it is the chosen day.
for (let i = 0; i < 3; i += 1) {
  await h.tapText(page, 'Huom.', { selector: '.bk-day' });
  await h.wait(900);
  if (await page.$eval('.bk-day[aria-pressed="true"]', (e) => e.textContent.includes('Huom.')).catch(() => false)) break;
}
const opened = await page.evaluate(() => {
  const tile = [...document.querySelectorAll('.bk-time')].find((b) => b.querySelector('.bk-time-clock')?.textContent === '19.00'
    && !b.classList.contains('is-full') && !b.classList.contains('is-sale'));
  tile?.setAttribute('data-e2e', 'tile');
  return Boolean(tile);
});
h.check('tomorrow 19.00 has a free court', opened);
await h.tapText(page, '19.00', { selector: '[data-e2e="tile"]' });
await h.wait(900);
await h.tapText(page, 'Jaa neljälle', { selector: '[role="tab"]' });
await h.wait(900);
for (const name of ['Mikko', 'Laura', 'Ville']) {
  await h.tapText(page, name, { selector: '.bk-friend' });
  await h.wait(250);
}
const footer = await page.$eval('.sheet-footer', (e) => e.innerText.replace(/\s+/g, ' ').trim());
h.check('three friends picked: pay my own part', /Varaa ja maksa osuutesi \d+(,\d+)? €/.test(footer), footer);
await h.tapText(page, 'Varaa ja maksa osuutesi', { selector: '.sheet-footer button' });
await h.wait(1500);
h.check('pay step says the card is saved for the rest', (await dialog()).includes('Korttisi tallennetaan Stripeen'), await dialog());
await h.tapText(page, 'Maksa ', { selector: '.bk-paybox button' });
await h.wait(1500);
const done = await dialog();
h.check('done: the friends were asked', done.includes('Kenttä varattu!') && done.includes('Mikko, Laura ja Ville saivat viestin'), done);
h.check('done: who has paid', (done.match(/Odottaa/g) || []).length === 3 && done.includes('Maksettu'), done);
await h.tapText(page, 'Valmis', { selector: '.sheet-footer button' });
await h.wait(1000);

// The demo's friends pay within ~20 s; my bookings are on Omat varaukset (the top bar).
await h.wait(30_000);
await h.tapText(page, 'Omat vuorot', { selector: 'button.icon-btn' });
await h.wait(1500);
await page.evaluate(() => [...document.querySelectorAll('.ss-row')].find((b) => b.textContent.includes('klo 19.00'))?.setAttribute('data-e2e', 'split'));
await h.tapText(page, '19.00', { selector: '[data-e2e="split"]' });
await h.wait(1200);
const lines = await text('.bk-split-line');
h.check('two friends have paid, one still owes', lines.filter((l) => l.includes('Maksettu')).length === 3 && lines.filter((l) => l.includes('Odottaa')).length === 1, lines);
await h.tapText(page, 'Sulje', { selector: '.sheet-close-floating' });
await h.wait(800);

// ── The friend's side: Mikko's request, from the chat ──
await page.evaluate(() => document.querySelector('a[href="/demo/viestit"]').click());
await h.wait(1500);
await h.tapText(page, 'Mikko', { selector: 'button.msg-row-main' });
await h.wait(1500);
const buttons = await text('.chat-share-btn');
h.check('the chat shows the requests as buttons', buttons.includes('Maksa osuutesi') && buttons.includes('Katso maksut'), buttons);
h.check('Mikko answered after paying', (await text('.chat-bubble')).some((b) => b.includes('Maksoin osuuteni')));
await h.tapText(page, 'Maksa osuutesi', { selector: '.chat-share-btn' });
await h.wait(1500);
h.check('the share page opened', (await h.state(page)).path.startsWith('/demo/osuus/'), (await h.state(page)).path);
await h.tapText(page, 'Maksa 15 €', { selector: '.bk-paybox button' });
await h.wait(1500);
h.check('my share is paid', (await text('main')).some((t) => t.includes('Osuutesi on maksettu')));

// ── The rest a declined card left, from the booking page (a fresh demo) ──
await page.goto(h.url('/demo/varaa'), { waitUntil: 'networkidle0' });
await h.wait(900);
await h.tapText(page, 'Maksamattomat maksut', { selector: '.bk-unpaid-row' });
await h.wait(900);
await h.tapText(page, 'Loppuosuus maksamatta', { selector: '.bk-owe' });
await h.wait(1500);
h.check('the rest page says the card was declined', (await text('main')).some((t) => t.includes('Kortti hylättiin')));
await h.tapText(page, 'Maksa 15 €', { selector: '.bk-paybox button' });
await h.wait(1500);
h.check('the rest is paid', (await text('main')).some((t) => t.includes('Loppuosuus on maksettu')));

// ── Laita myyntiin: the booking inside the 24-hour limit, from Omat varaukset ──
await page.evaluate(() => window.history.back());
await h.wait(1500);
await h.tapText(page, 'Omat vuorot', { selector: 'button.icon-btn' });
await h.wait(1500);
await page.evaluate(() => document.querySelector('.ss-row')?.setAttribute('data-e2e', 'soon'));
await h.tapText(page, '', { selector: '[data-e2e="soon"]' });
await h.wait(1200);
await h.tapText(page, 'Laita vuoro myyntiin', { selector: '.sheet button' });
await h.wait(700);
await h.tapText(page, 'Laita myyntiin', { selector: '.sheet-actions button' });
await h.wait(1500);
h.check('on sale', (await toasts()).some((t) => t.includes('Vuoro on myynnissä')) && (await text('.ss-row'))[0]?.includes('Myynnissä'), [await toasts(), (await text('.ss-row'))[0]]);
// Back on the booking page, which says when it sells.
await page.evaluate(() => window.history.back());
await h.wait(1000);
let sold = false;
for (let i = 0; i < 45 && !sold; i += 1) {
  await h.wait(1000);
  sold = (await toasts()).some((t) => t.includes('Vuorosi myytiin'));
}
h.check('somebody booked it and the money is coming back', sold, await toasts());
h.check('no horizontal scroll', !(await h.state(page)).overflowX);

await h.finish();
