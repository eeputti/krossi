// Accounts made from 11.11.2026 on never knew the old Koutsi: the new app hides the note and
// "Palaa vanhaan" (shared/renewed.jsx), and the old app sends them to the new one
// (lib/koutsi-auth.jsx). Both must use the same moment.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const moment = (file, name) => {
  const m = new RegExp(`${name} = '([^']+)'`).exec(readFileSync(join(root, file), 'utf8'));
  assert.ok(m, `${name} not found in ${file}`);
  return m[1];
};

test('old and new Koutsi agree on when new-only accounts start', () => {
  const fresh = moment('koutsi/web/src/shared/renewed.jsx', 'NEW_ONLY_SINCE');
  const old = moment('lib/koutsi-auth.jsx', 'KOUTSI_NEW_ONLY_SINCE');
  assert.equal(fresh, old);
  // midnight 11.11.2026 in Finland
  assert.equal(new Date(fresh).toISOString(), '2026-11-10T22:00:00.000Z');
});
