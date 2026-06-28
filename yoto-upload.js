#!/usr/bin/env node
/**
 * yoto-upload.js — create a Yoto MYO playlist from a local folder of mp3s + 16x16 icons.
 *
 * Reads <folder>/playlist.json (title + ordered tracks), uploads each song's audio,
 * uploads its matching pixel-art icon, then creates one playlist where every song is a
 * chapter showing its own icon. Auth is OAuth2 Authorization-Code + PKCE via a one-time
 * browser sign-in; the refresh token is cached so later runs don't prompt again.
 *
 * Zero npm dependencies — uses Node 22 built-ins (http, crypto, fs) + global fetch/FormData/Blob.
 *
 * Setup (once):
 *   1. Create a PUBLIC client at https://dashboard.yoto.dev
 *   2. Register redirect URL:  http://127.0.0.1:8787/callback
 *   3. Put YOTO_CLIENT_ID=your_client_id in a .env file next to this script
 *      (or export it in your shell) — .env is auto-loaded and git-ignored.
 *
 * Usage:
 *   node yoto-upload.js [folder]          # default folder: $YOTO_PLAYLIST_DIR or my-playlist
 *   node yoto-upload.js --reset-auth      # force a fresh browser sign-in
 */

const fs = require('fs');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const { exec } = require('child_process');

// Auto-load .env from the repo root if present (Node 22 built-in, no dep).
try { process.loadEnvFile(path.join(__dirname, '.env')); } catch { /* no .env, fall back to real env */ }

// ---- config ----
const API = 'https://api.yotoplay.com';
const LOGIN = 'https://login.yotoplay.com';
const REDIRECT_URI = 'http://127.0.0.1:8787/callback';
const REDIRECT_PORT = 8787;
const SCOPE = 'user:content:manage offline_access'; // create content + upload icons + refresh
const CLIENT_ID = process.env.YOTO_CLIENT_ID;
const TOKEN_FILE = path.join(__dirname, '.yoto-token.json'); // cached refresh token — do not commit

const args = process.argv.slice(2);
const RESET_AUTH = args.includes('--reset-auth');
const FOLDER = path.resolve(args.find((a) => !a.startsWith('--')) || process.env.YOTO_PLAYLIST_DIR || 'my-playlist');

// ---- tiny helpers ----
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const b64url = (buf) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const log = (...a) => console.log(...a);
const die = (msg) => { console.error('\n✖ ' + msg); process.exit(1); };

async function jsonOrThrow(res, label) {
  if (!res.ok) {
    let body = '';
    try { body = await res.text(); } catch {}
    throw new Error(`${label} failed: HTTP ${res.status} ${res.statusText}\n${body.slice(0, 500)}`);
  }
  return res.json();
}

// ---- auth: refresh-token path, else browser PKCE ----
function loadToken() {
  try { return JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8')); } catch { return null; }
}
function saveToken(obj) {
  fs.writeFileSync(TOKEN_FILE, JSON.stringify(obj, null, 2));
}

async function refreshAccessToken(refresh_token) {
  const res = await fetch(`${LOGIN}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'refresh_token', client_id: CLIENT_ID, refresh_token }),
  });
  if (!res.ok) return null; // refresh expired/invalid → fall back to full login
  const data = await res.json();
  // refresh tokens are single-use; persist the new one
  saveToken({ refresh_token: data.refresh_token || refresh_token });
  return data.access_token;
}

function waitForCallbackCode() {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const u = new URL(req.url, `http://127.0.0.1:${REDIRECT_PORT}`);
      if (u.pathname !== '/callback') { res.writeHead(404); return res.end(); }
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end('<html><body style="font:16px system-ui;padding:3rem;text-align:center">' +
        '<h2>✅ Login complete</h2><p>You can close this tab and return to your terminal.</p></body></html>');
      server.close();
      const err = u.searchParams.get('error');
      if (err) reject(new Error(`${err}: ${u.searchParams.get('error_description') || ''}`));
      else resolve(u.searchParams.get('code'));
    });
    server.on('error', reject);
    server.listen(REDIRECT_PORT, '127.0.0.1');
  });
}

async function browserLogin() {
  const code_verifier = b64url(crypto.randomBytes(32));
  const code_challenge = b64url(crypto.createHash('sha256').update(code_verifier).digest());
  const authUrl = new URL(`${LOGIN}/authorize`);
  authUrl.search = new URLSearchParams({
    audience: API,
    scope: SCOPE,
    response_type: 'code',
    client_id: CLIENT_ID,
    code_challenge,
    code_challenge_method: 'S256',
    redirect_uri: REDIRECT_URI,
  }).toString();

  const codePromise = waitForCallbackCode();
  log('\nOpening your browser to sign in to Yoto…');
  log('If it does not open, paste this URL manually:\n' + authUrl.toString() + '\n');
  exec(`open "${authUrl.toString()}"`); // macOS

  const code = await codePromise;
  const res = await fetch(`${LOGIN}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: CLIENT_ID,
      code_verifier,
      code,
      redirect_uri: REDIRECT_URI,
    }),
  });
  const data = await jsonOrThrow(res, 'Token exchange');
  saveToken({ refresh_token: data.refresh_token });
  return data.access_token;
}

async function getAccessToken() {
  if (RESET_AUTH) { try { fs.unlinkSync(TOKEN_FILE); } catch {} }
  const saved = loadToken();
  if (saved?.refresh_token) {
    const tok = await refreshAccessToken(saved.refresh_token);
    if (tok) { log('✓ Reused saved Yoto login (refreshed token)'); return tok; }
    log('Saved login expired — signing in again…');
  }
  return browserLogin();
}

// ---- Yoto media API ----
async function uploadAudio(token, fileBuf, contentType) {
  // 1. get a one-time upload URL
  const got = await jsonOrThrow(
    await fetch(`${API}/media/transcode/audio/uploadUrl`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    }),
    'Request upload URL'
  );
  const { uploadUrl, uploadId } = got.upload;
  // 2. PUT the raw audio
  const put = await fetch(uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': contentType },
    body: new Blob([fileBuf], { type: contentType }),
  });
  if (!put.ok) throw new Error(`Audio PUT failed: HTTP ${put.status}`);
  // 3. poll until transcoded
  for (let i = 0; i < 120; i++) {
    const res = await fetch(`${API}/media/upload/${uploadId}/transcoded?loudnorm=false`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    });
    if (res.ok) {
      const data = await res.json();
      if (data.transcode?.transcodedSha256) return data.transcode; // { transcodedSha256, transcodedInfo }
    }
    await sleep(1000);
  }
  throw new Error('Transcoding timed out');
}

async function uploadIcon(token, iconPath) {
  const buf = fs.readFileSync(iconPath);
  const name = path.basename(iconPath, path.extname(iconPath));
  const url = `${API}/media/displayIcons/user/me/upload?autoConvert=true&filename=${encodeURIComponent(name)}`;
  // API expects the raw binary image as the body (not multipart form-data)
  const data = await jsonOrThrow(
    await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'image/png' },
      body: buf,
    }),
    'Icon upload'
  );
  return data.displayIcon.mediaId;
}

async function createContent(token, body) {
  return jsonOrThrow(
    await fetch(`${API}/content`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
    'Create content'
  );
}

// ---- persist a new cardId back into playlist.json, preserving its formatting ----
function saveCardId(manifestPath, cardId) {
  const raw = fs.readFileSync(manifestPath, 'utf8');
  const safe = String(cardId).replace(/"/g, '');
  let next;
  if (/"cardId"\s*:/.test(raw)) {
    next = raw.replace(/"cardId"\s*:\s*(?:null|"[^"]*")/, `"cardId": "${safe}"`);
  } else {
    next = raw.replace(/^\s*{/, `{\n  "cardId": "${safe}",`); // inject as first field
  }
  fs.writeFileSync(manifestPath, next);
}

// ---- match an mp3 in the folder by a distinctive substring (NFC-normalized) ----
function findMp3(files, match) {
  const m = match.normalize('NFC').toLowerCase();
  const hits = files.filter((f) => f.normalize('NFC').toLowerCase().includes(m));
  if (hits.length === 0) throw new Error(`No mp3 matching "${match}"`);
  if (hits.length > 1) throw new Error(`"${match}" matched ${hits.length} files: ${hits.join(', ')}`);
  return hits[0];
}

// ---- derive a stable per-track chapter key from its title (not its array position) ----
// The player caches downloaded chapter audio by key. If key were just the track's
// position (as it used to be), adding/removing a track shifts everyone after it, so an
// existing key gets reassigned to a *different* song — the player then serves its old
// cached audio for that key until it happens to resync. Hashing the title keeps a given
// track's key fixed across reorders/add/remove, so only genuinely new tracks get new keys.
function stableKey(title, used) {
  const hash = crypto.createHash('sha256').update(title).digest();
  let n = hash[0] % 99;
  let key = String(n + 1).padStart(2, '0');
  for (let offset = 1; used.has(key); offset++) {
    n = (n + hash[offset % hash.length] + offset) % 99;
    key = String(n + 1).padStart(2, '0');
  }
  used.add(key);
  return key;
}

// ---- main ----
(async () => {
  if (!CLIENT_ID) die('Set YOTO_CLIENT_ID first (create a public client at https://dashboard.yoto.dev,\n  register redirect http://127.0.0.1:8787/callback, then: export YOTO_CLIENT_ID=...).');

  const manifestPath = path.join(FOLDER, 'playlist.json');
  if (!fs.existsSync(manifestPath)) die(`No playlist.json in ${FOLDER}`);
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const iconsDir = path.join(FOLDER, 'icons');
  const mp3s = fs.readdirSync(FOLDER).filter((f) => f.toLowerCase().endsWith('.mp3'));

  // resolve every track to a real audio + icon file up front, so we fail fast on typos
  const usedKeys = new Set();
  const plan = manifest.tracks.map((t, i) => {
    const mp3 = findMp3(mp3s, t.match);
    const icon = path.join(iconsDir, t.icon);
    if (!fs.existsSync(icon)) throw new Error(`Missing icon: ${icon}`);
    return { n: i + 1, title: t.title, key: stableKey(t.title, usedKeys), audioPath: path.join(FOLDER, mp3), iconPath: icon };
  });

  log(`\nPlaylist: "${manifest.title}"  (${plan.length} tracks)`);
  plan.forEach((p) => log(`  ${String(p.n).padStart(2)}. ${p.title}  ←  ${path.basename(p.audioPath)}`));

  const token = await getAccessToken();

  const chapters = [];
  let totalDuration = 0;
  let totalFileSize = 0;

  for (const p of plan) {
    log(`\n[${p.n}/${plan.length}] ${p.title}`);
    log('   ↑ uploading audio + transcoding…');
    const tr = await uploadAudio(token, fs.readFileSync(p.audioPath), 'audio/mpeg');
    const info = tr.transcodedInfo || {};
    log('   ↑ uploading icon…');
    const mediaId = await uploadIcon(token, p.iconPath);

    const disp = { icon16x16: `yoto:#${mediaId}` };
    chapters.push({
      key: p.key,
      title: p.title,
      overlayLabel: String(p.n),
      display: disp,
      tracks: [{
        key: '01',
        title: p.title,
        trackUrl: `yoto:#${tr.transcodedSha256}`,
        type: 'audio',
        format: info.format,
        duration: info.duration,
        fileSize: info.fileSize,
        channels: info.channels,
        overlayLabel: String(p.n),
        display: disp,
      }],
    });
    totalDuration += info.duration || 0;
    totalFileSize += info.fileSize || 0;
    log(`   ✓ done (${info.duration ? Math.round(info.duration) + 's' : '?'})`);
  }

  const existingCardId = manifest.cardId || null;
  log(existingCardId ? `\nUpdating existing playlist (cardId ${existingCardId})…` : '\nCreating playlist…');
  const created = await createContent(token, {
    ...(existingCardId ? { cardId: existingCardId } : {}), // present → update that card, absent → create new
    title: manifest.title,
    content: { chapters },
    metadata: {
      media: {
        duration: totalDuration,
        fileSize: totalFileSize,
        readableFileSize: Math.round((totalFileSize / 1024 / 1024) * 10) / 10,
      },
    },
  });

  const newCardId = created.cardId || created.card?.cardId || created.contentId || null;

  if (existingCardId) {
    log('\n✅ Playlist updated on your Yoto account.');
    log(`   Title:  ${manifest.title}`);
    log(`   cardId: ${existingCardId}`);
    log('\nThe linked card now points at the updated content (no re-linking needed).');
  } else {
    if (newCardId) saveCardId(manifestPath, newCardId); // persist so future runs update, not duplicate
    log('\n✅ Playlist created on your Yoto account.');
    log(`   Title:  ${manifest.title}`);
    log(`   cardId: ${newCardId || '(see Yoto app)'}`);
    if (newCardId) log('   ↳ saved to playlist.json — re-running now updates this same playlist.');
    log('\nNext: open the Yoto app → it appears in your library. To play it on a physical');
    log('MYO card, open the playlist → "Link to a card" → tap your MYO card.');
  }
})().catch((e) => die(e.message || String(e)));
