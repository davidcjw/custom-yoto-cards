# Custom Yoto Cards — Project Reference

Goal: replicate the "make your own Yoto cards" process — clone a genuine Yoto MYO
card's playlist link onto cheap generic NFC cards.

## Core insight
A Yoto card is NOT storage for audio. It is a tiny NFC tag holding a single URL
(e.g. `https://yoto.io/XXXXX`). The Yoto player reads that URL and streams the
matching playlist from the user's Yoto cloud account. Therefore:
- "Cloning" a card = copying that one URL (NDEF URI record) to another tag.
- Updating a playlist needs no card change — the card just points to the playlist.
- One genuine MYO card can be reused indefinitely as the "source" to clone from.

## Implemented pipeline: download → Yoto API upload (PRIMARY, code-based)
<!-- MAINTENANCE: keep this section in sync whenever the flow or yoto-upload.js changes. -->
This is the working software flow we built. It uses the official **Yoto Developer
API** (docs https://yoto.dev, base `https://api.yotoplay.com`) and **supersedes the
manual NFC-clone steps below for creating/updating content**. The NFC cloning further
down is now only relevant for making extra cheap cards, not for the content itself.

**Artifacts (in this repo):**
- `yoto-upload.js` (repo root) — zero-dependency Node script (Node 22 built-ins +
  global `fetch`/`FormData`). Auth = OAuth2 Authorization-Code + PKCE via a one-time
  browser sign-in caught on a local `127.0.0.1:8787` callback; the refresh token is
  cached in `.yoto-token.json` (do NOT commit) so later runs need no login.
- `<folder>/playlist.json` — editable manifest:
  `{ cardId, title, tracks: [{ title, match, icon }] }`.
  - `match` = distinctive substring used to locate the mp3 in `<folder>` (NFC-
    normalized, case-insensitive, must match exactly one file).
  - `icon` = PNG filename under `<folder>/icons/`.
- `<folder>/icons/` — one **16×16** PNG pixel-art icon per song.

**One-time setup (once ever):**
1. dashboard.yoto.dev → create a **Public** client → register redirect
   `http://127.0.0.1:8787/callback`.
2. `export YOTO_CLIENT_ID=...` (ideally in shell profile).

**Per-batch flow (who does what):**
1. (you) give YouTube URLs + folder name + any trims.
2. (Claude) download audio — **latest yt-dlp binary + `--js-runtimes node`** (system
   yt-dlp is broken; see memory `yt-dlp-youtube-gotcha`). Trim via
   `--download-sections "*START-END"` (e.g. `*0-40`, `*10-188`).
3. (Claude) hand-design one themed 16×16 PNG icon per song into `<folder>/icons/`,
   render a preview, iterate until each reads clearly. Done automatically for any song
   download unless told otherwise (memory `songs-generate-yoto-art`).
4. (Claude) write/update `<folder>/playlist.json`.
5. (you for the FIRST run; Claude for later runs once the token is cached)
   `node yoto-upload.js <folder>` (default folder: `$YOTO_PLAYLIST_DIR`, else `my-playlist`).
6. (you) Yoto app → open the playlist → "Link to a card" → tap MYO card.

**What `yoto-upload.js` does, per song:** `GET /media/transcode/audio/uploadUrl` →
`PUT` the mp3 to the returned URL → poll `GET /media/upload/{id}/transcoded?loudnorm=false`
until `transcodedSha256` → `POST /media/displayIcons/user/me/upload?autoConvert=true`
(icon → `mediaId`). Then one `POST /content` builds a playlist where **each song is a
chapter showing its own icon** (`track.trackUrl = yoto:#<sha256>`,
`display.icon16x16 = yoto:#<mediaId>`). OAuth scope: `user:content:manage offline_access`.

GOTCHAS (learned the hard way): (1) the icon upload body must be the **raw binary PNG**
with `Content-Type: image/png` — NOT multipart form-data (that returns 400 "A binary
image file is required"). (2) The OAuth scopes must be **pre-ticked + saved on the app**
in dashboard.yoto.dev, else login fails with `access_denied: scopes not pre-approved`.
(3) App client type must be **Public**; redirect must be exactly
`http://127.0.0.1:8787/callback`.

**cardId behavior (create vs update):** if `playlist.json.cardId` is `null`, the run
CREATES a new playlist and writes the returned cardId back into `playlist.json`
(format-preserving). On later runs cardId is set, so `POST /content` includes it and
UPDATES the same playlist/card in place — no duplicate, no re-linking the card.

## Hardware
- Yoto player (owned)
- Genuine Yoto MYO card (owned) — used as the link source
- Generic blank tags: **MIFARE Ultralight EV1, 48-byte** version.
  - Do NOT buy the 128-byte version (needs a cumbersome extra hack).
  - Source example: ABC RFID (~$50 / 200) vs Yoto MYO (~$30 / 10).

## Software needed — manual process (no code)
1. **Yoto web** (my.yotoplay.com/my-cards/playlists) — create/arrange playlists.
2. **Yoto app** (iOS/Android) — link a playlist to the genuine MYO card:
   Library > Playlists > open playlist > "Link to a card" > "Use your phone" >
   tap MYO card to top edge of phone.
3. **NFC Tools app** (by wakdev, iOS/Android) — format + clone generic cards.

## Manual procedure (per the Reddit guide)
1. Create playlist (Yoto web) and link it to the genuine MYO card (Yoto app).
2. One-time NDEF format of each blank generic card, via NFC Tools:
   Other > Advanced NFC Commands > "I understand" > paste into Data field:
   `A2:03:E1:10:06:00,A2:04:03:04:D8:00,A2:05:00:00:FE:00`
   Send command, tap the generic card.
3. Clone the URL: NFC Tools > Write > More options > Import from NFC tag >
   tap the genuine MYO card. When the yoto.io URI appears, tap "Write / ~45 Bytes",
   then tap the generic card.
4. **CRITICAL — download content to the player FIRST.** A byte-perfect clone still
   shows the red stop sign ("card not recognised") until the playlist is cached on
   the target player. The player resolves the card URL against the cloud by the
   card's hardware NFC UID; the clone's UID is unregistered, so the cloud rejects
   it. Fix: with the player online, play the playlist (genuine card or Yoto app)
   until all tracks download (no blue streaming-cloud icon; plays with WiFi off).
   THEN insert the clone — it matches the URL to local content and plays.
Re-writing a new playlist later only needs steps 1 + 3 (NDEF format is one-time);
re-run step 4 on any player that hasn't yet cached the new playlist.

## What the NDEF format command does
Three raw MIFARE Ultralight WRITE PAGE commands (`A2` = write, next byte = page #):
- Page 3 `E1 10 06 00` — Capability Container: E1 NDEF magic, 10 = v1.0,
  06 = 48 bytes usable, 00 = read/write.
- Page 4 `03 04 D8 00` — NDEF message TLV start (03 = tag, 04 = length).
- Page 5 `00 00 FE 00` — FE = terminator TLV.
Net effect: marks the blank as a valid, writable NDEF tag.

## Building our own software (the "replicate the software" goal)
STATUS: the content side (create playlist + art + link target) is now DONE via the
Yoto API — see "Implemented pipeline" at the top. The ACR122U/nfcpy approach below
remains only a future option for writing the URL onto cheap blank NFC tags in batch.

Replace the phone + NFC Tools with a desktop batch tool:
- Reader: USB NFC reader **ACR122U** (~$35) — supports MIFARE Ultralight EV1.
- Library: **nfcpy** (Python) or **libnfc**.
- Two functions to reproduce:
  1. Read the NDEF URI record off the genuine MYO card.
  2. Format a blank (write CC + NDEF TLV to pages 3/4/5) and write that URI as an
     NDEF URI record. Loop over many blanks for batch prep.

## Notes / gotchas
- Yoto URLs are ~45 bytes — fits comfortably in the 48-byte tag.
- Keep the genuine MYO card; it is the reusable master source.
- This is for personal use cloning of your own purchased/owned content links.
