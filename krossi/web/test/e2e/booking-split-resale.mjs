// booking-split-resale.mjs — phone-emulated end-to-end run of court booking phase 4 in the demo:
// booking in one sheet (the court and the payment together), "Jaa maksu" by link (the payment page
// works like a friend's without an account; a friend of the demo pays a part by himself and the
// booking page says so), the friend's side (pay Mikko's link from the chat), and "Laita myyntiin"
// from Omat varaukset (sell a booking past its free cancellation; somebody books it and the
// booking page says so).
// Uses the build in <out>/site from snap.mjs; takes about a minute (the demo's friend and buyer
// answer after a few seconds). E2E_SHOTS=<dir> also saves a screenshot of each step there.
//
//   node krossi/web/scripts/snap.mjs --out /tmp/x /demo/varaa   (builds <out>/site once)
//   node krossi/web/test/e2e/booking-split-resale.mjs /tmp/x
import { startHarness } from './harness.mjs';

const h = await startHarness(process.argv[2], { name: 'booking-split-resale' });
const page = await h.phone();
const text = (selector) => page.$$eval(selector, (els) => els.map((e) => e.innerText.replace(/\s+/g, ' ').trim()));
const dialog = () => page.$eval('.sheet-root:not(.is-closing) .sheet', (e) => e.innerText.replace(/\s+/g, ' ').trim()).catch(() => '');
const toasts = async () => (await h.state(page)).toasts;
const shot = async (name) => { if (process.env.E2E_SHOTS) await page.screenshot({ path: `${process.env.E2E_SHOTS}/${name}.png` }); };

await page.goto(h.url('/demo/varaa'), { waitUntil: 'networkidle0' });
await h.wait(900);
h.check('nothing unpaid: no payments row', (await text('.bk-unpaid-row')).length === 0, await text('.bk-unpaid-row'));
h.check('somebody\'s slot on sale is a row among the times', (await text('.bk-time.is-sale')).length === 1, await text('.bk-time.is-sale'));
await shot('1-page');

// ── Book tomorrow at 19 in one sheet ──
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
await h.wait(1200);
const sheet = await dialog();
h.check('one sheet: the court, its line and the payment together', /Maksa \d+(,\d+)? €/.test(sheet) && sheet.includes('Maksuton peruutus') && !sheet.includes('Kesto'), sheet);
await shot('2-sheet');
await h.tapText(page, 'Maksa ', { selector: '.bk-paybox button' });
await h.wait(1500);
const done = await dialog();
h.check('done: Kenttä varattu! and Jaa maksu', done.includes('Kenttä varattu!') && done.includes('Jaa maksu kavereiden kesken'), done);
await shot('3-done');

// ── Jaa maksu: nelinpeli, then the link ──
await h.tapText(page, 'Nelinpeli', { selector: '[role="tab"]' });
await h.wait(500);
h.check('a part is a quarter of the price', /\d+(,\d+)? € \/ pelaaja/.test(await dialog()), await dialog());
await h.tapText(page, 'Lähetä maksulinkki', { selector: '.bk-splitcard button' });
await h.wait(1500);
const card = (await text('.bk-splitcard'))[0] || '';
h.check('the card shows the parts and how many have paid', /Nelinpeli · .* \/ pelaaja/.test(card) && /\d\/3 maksanut/.test(card), card);
await shot('4-split');
await h.tapText(page, 'Katso maksusivu', { selector: '.bk-splitcard button' });
await h.wait(1500);
h.check('the payment page opened', (await h.state(page)).path.startsWith('/demo/maksa/'), (await h.state(page)).path);
const payPage = (await text('main'))[0] || '';
h.check('it says who booked and what one part costs', payPage.includes('Alex varasi kentän') && /osuutesi/i.test(payPage), payPage);
h.check('and shows the way to Krossi', payPage.includes('Löydä uutta peliseuraa'), payPage);
await shot('5-pay-page');
await page.type('.splitpay-name input', 'Sanna');
await h.tapText(page, 'Maksa ', { selector: '.bk-paybox button' });
await h.wait(1500);
h.check('the part is paid', ((await text('main'))[0] || '').includes('Osuutesi on maksettu'));
await shot('6-paid');

// Back on the booking page: a friend of the demo pays another part a little later, and it says so.
await page.evaluate(() => window.history.back());
await h.wait(1000);
let heard = false;
for (let i = 0; i < 30 && !heard; i += 1) {
  await h.wait(1000);
  heard = (await toasts()).some((t) => /maksoi osuutensa .* palautetaan sinulle/.test(t));
}
h.check('the booking page says when a friend paid', heard, await toasts());

// ── The friend's side: Mikko's link, from the chat ──
await page.evaluate(() => document.querySelector('a[href="/demo/viestit"]').click());
await h.wait(1500);
await h.tapText(page, 'Mikko', { selector: 'button.msg-row-main' });
await h.wait(1500);
const buttons = await text('.chat-share-btn');
h.check('the chat shows the link as a button', buttons.includes('Maksa osuutesi'), buttons);
await h.tapText(page, 'Maksa osuutesi', { selector: '.chat-share-btn' });
await h.wait(1500);
h.check('Mikko\'s payment page opened', (await h.state(page)).path.startsWith('/demo/maksa/'), (await h.state(page)).path);
await h.tapText(page, 'Maksa 15 €', { selector: '.bk-paybox button' });
await h.wait(1500);
h.check('my part is paid', ((await text('main'))[0] || '').includes('Osuutesi on maksettu'));

// ── Laita myyntiin: the booking inside the 24-hour limit, from Omat varaukset (a fresh demo) ──
await page.goto(h.url('/demo/varaa'), { waitUntil: 'networkidle0' });
await h.wait(1200);
await h.tapText(page, 'Omat varaukset', { selector: 'button.icon-btn' });
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
