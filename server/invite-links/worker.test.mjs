import assert from 'node:assert/strict';
import test from 'node:test';

import worker, { assetLinks } from './worker.mjs';

const env = { ANDROID_CERT_SHA256: 'ab:'.repeat(31) + 'ab, junk', APP_DOWNLOAD_URL: 'https://example.org/app' };
const get = (path) => worker.fetch(new Request(`https://invite.example.org${path}`), env);

test('assetlinks lists only well-formed fingerprints for the app package', async () => {
  const links = assetLinks(env);
  assert.equal(links[0].target.package_name, 'com.sreenathsreesree.tripprep');
  assert.deepEqual(links[0].target.sha256_cert_fingerprints, ['AB:'.repeat(31) + 'AB']);
  const res = await get('/.well-known/assetlinks.json');
  assert.equal(res.headers.get('content-type'), 'application/json');
});

test('join page offers an intent link with a browser fallback and the code', async () => {
  const token = 'Ab_cd-EF0123456789xyzQ';
  const res = await get(`/join/${encodeURIComponent(token)}`);
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.match(html, /intent:\/\/join\/Ab_cd-EF0123456789xyzQ#Intent;scheme=tripprep;package=com\.sreenathsreesree\.tripprep;S\.browser_fallback_url=/);
  assert.match(html, /tripprep:\/\/join\/Ab_cd-EF0123456789xyzQ/);
  assert.match(html, /https:\/\/example\.org\/app/);
});

test('rejects malformed tokens without echoing them', async () => {
  const res = await get('/join/%3Cscript%3E');
  assert.equal(res.status, 404);
  assert.doesNotMatch(await res.text(), /script/);
});
