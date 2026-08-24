// Smoke-tests a running `wrangler dev` instance with the production hostnames.

import assert from 'node:assert/strict';
import http from 'node:http';

const port = Number(process.env.KROSSI_CLOUDFLARE_PORT || 8787);

function request(host, path) {
  return new Promise((resolve, reject) => {
    const req = http.get({ hostname: '127.0.0.1', port, path, headers: { host } }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => resolve({
        status: response.statusCode,
        contentType: response.headers['content-type'] || '',
        body: Buffer.concat(chunks).toString('utf8'),
      }));
    });
    req.on('error', reject);
  });
}

const pages = [
  ['krossi.app', '/', 'Krossi — Löydä uusia pelikavereita'],
  ['krossi.app', '/pelaa', 'Krossi — Selainversio'],
  ['koutsi.krossi.app', '/', 'Krossi Koutsi — Valmennus ja kehitys. Samassa paikassa.'],
  ['koutsi.krossi.app', '/valmentaja/oppilaat?auth=login', 'Valmentajan näkymä — Krossi Koutsi'],
  ['koutsi.krossi.app', '/pelaaja/treenit?koodi=ABC', 'Pelaajan näkymä — Krossi Koutsi'],
  ['koutsi.krossi.app', '/tietosuoja', 'Tietosuojaseloste — Krossi Koutsi'],
  ['koutsi.krossi.app', '/kayttoehdot', 'Käyttöehdot — Krossi Koutsi'],
  ['demo.koutsi.krossi.app', '/', 'Kokeile demoa — Krossi Koutsi'],
  ['demo.koutsi.krossi.app', '/valmentaja/ryhmat', 'Valmentajan näkymä (demo) — Krossi Koutsi'],
  ['demo.koutsi.krossi.app', '/pelaaja/treenit', 'Pelaajan näkymä (demo) — Krossi Koutsi'],
];

await Promise.all(pages.map(async ([host, path, title]) => {
  const response = await request(host, path);
  assert.equal(response.status, 200, `${host}${path}`);
  assert.match(response.contentType, /^text\/html/, `${host}${path}`);
  assert.ok(response.body.includes(`<title>${title}</title>`), `${host}${path}`);
}));

const asset = await request('koutsi.krossi.app', '/assets/ball-tight.png');
assert.equal(asset.status, 200);
assert.match(asset.contentType, /^image\/png/);

const missing = await request('koutsi.krossi.app', '/ei-ole-olemassa');
assert.equal(missing.status, 404);

console.log(`${pages.length} sivureittiä, staattinen assetti ja 404-vastaus OK`);
