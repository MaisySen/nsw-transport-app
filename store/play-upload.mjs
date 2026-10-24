#!/usr/bin/env node
// Uploads the signed release AAB to a Google Play track (internal by default).
// Needs a Google Cloud service account JSON key whose email has been invited in Play Console
// (Users and permissions, with Release to testing tracks). No libraries: Node 18 or later.
//
//   PLAY_SERVICE_ACCOUNT=/path/to/key.json node store/play-upload.mjs app/android/app/build/outputs/bundle/release/app-release.aab [track]
//
// The very first AAB of a new app has to be uploaded in the Play Console web page; this script is for every one after.
import fs from 'node:fs';
import crypto from 'node:crypto';

const PKG = 'com.maisysen.nswtransport';
const [aab, track = 'internal'] = process.argv.slice(2);
const keyPath = process.env.PLAY_SERVICE_ACCOUNT;
if (!aab || !fs.existsSync(aab) || !keyPath) {
  console.error('Usage: PLAY_SERVICE_ACCOUNT=key.json node store/play-upload.mjs app-release.aab [internal|alpha|beta|production]');
  process.exit(1);
}
const sa = JSON.parse(fs.readFileSync(keyPath, 'utf8'));
const b64 = (x) => Buffer.from(x).toString('base64url');

async function token() {
  const now = Math.floor(Date.now() / 1000);
  const head = b64(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claim = b64(JSON.stringify({ iss: sa.client_email, scope: 'https://www.googleapis.com/auth/androidpublisher', aud: sa.token_uri, iat: now, exp: now + 3600 }));
  const sig = crypto.createSign('RSA-SHA256').update(`${head}.${claim}`).sign(sa.private_key, 'base64url');
  const r = await fetch(sa.token_uri, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${head}.${claim}.${sig}` }) });
  const j = await r.json();
  if (!j.access_token) throw new Error('Token: ' + JSON.stringify(j));
  return j.access_token;
}

const API = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${PKG}`;
const UP = `https://androidpublisher.googleapis.com/upload/androidpublisher/v3/applications/${PKG}`;

async function call(t, method, url, body, type = 'application/json') {
  const r = await fetch(url, { method, headers: { authorization: `Bearer ${t}`, 'content-type': type }, body });
  const text = await r.text();
  if (!r.ok) throw new Error(`${method} ${url.replace(/\?.*/, '')}: ${r.status} ${text}`);
  return text ? JSON.parse(text) : {};
}

const t = await token();
const edit = await call(t, 'POST', `${API}/edits`, '{}');
console.log('edit', edit.id);
const bundle = await call(t, 'POST', `${UP}/edits/${edit.id}/bundles?uploadType=media`, fs.readFileSync(aab), 'application/octet-stream');
console.log('uploaded versionCode', bundle.versionCode);
const status = process.env.PLAY_STATUS || (track === 'production' ? 'draft' : 'completed');
await call(t, 'PUT', `${API}/edits/${edit.id}/tracks/${track}`, JSON.stringify({ track, releases: [{ versionCodes: [String(bundle.versionCode)], status }] }));
const done = await call(t, 'POST', `${API}/edits/${edit.id}:commit`, '');
console.log(`committed edit ${done.id}: versionCode ${bundle.versionCode} on the ${track} track (${status})`);
