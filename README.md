# Custom Yoto Cards — How to Put Your Own Audio on a Generic NFC Card

![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)
![Node](https://img.shields.io/badge/Node-18%2B-339933?logo=node.js&logoColor=white)
![Dependencies](https://img.shields.io/badge/dependencies-none-brightgreen.svg)

Clone a Yoto playlist link onto cheap generic NFC cards using only your phone.
A Yoto card just holds a URL pointing to a playlist in your Yoto cloud account —
so "making a card" means creating a playlist and copying its link onto a tag.

**This repo gives you two ways to make custom Yoto cards:**

1. **No code — phone only.** A step-by-step guide to clone a playlist link onto cheap
   generic NFC tags with just the Yoto and NFC Tools apps (all sections below).
2. **Scripted — [`yoto-upload.js`](yoto-upload.js).** A zero-dependency Node CLI that
   builds an entire Yoto playlist — audio **and** custom 16×16 pixel-art icons — from a
   local folder via the official [Yoto API](https://yoto.dev). See
   [Scripted upload](#scripted-upload-yoto-uploadjs).

## Table of Contents

- [What you need](#what-you-need)
- [One-time setup per blank card (NDEF format)](#one-time-setup-per-blank-card-ndef-format)
- [Putting audio on a card](#putting-audio-on-a-card)
- [Adding a NEW playlist on a NEW card](#adding-a-new-playlist-on-a-new-card)
- [Scripted upload: `yoto-upload.js`](#scripted-upload-yoto-uploadjs)
- [Notes](#notes)
- [Contributing](#contributing) · [Code of Conduct](#code-of-conduct) · [License](#license)

## What you need

- A Yoto player (to play the finished card)
- **1 genuine Yoto MYO card** (reused forever as the "master" source)
- **Generic blank tags: MIFARE Ultralight EV1, 48-byte** version
  (avoid the 128-byte version — it needs an extra hack)
- A smartphone with NFC (iPhone or Android)
- Two free apps / accounts:
  - **Yoto account + Yoto app** (iOS/Android)
  - **NFC Tools app** by wakdev (iOS/Android)

---

## One-time setup per blank card (NDEF format)

Each new blank card must be formatted **once** before it can be used.

1. Open **NFC Tools** > **Other** > **Advanced NFC Commands** > tap **I understand**.
2. In the **Data** field, paste exactly:
   ```
   A2:03:E1:10:06:00,A2:04:03:04:D8:00,A2:05:00:00:FE:00
   ```
3. Tap **Send command**, then hold the **blank generic card** to the top edge of
   your phone until it confirms.

(You only do this once per card. After this, skip to "Putting audio on a card".)

---

## Putting audio on a card

### Step 1 — Create the playlist (custom audio)

1. Go to **my.yotoplay.com/my-cards/playlists** and create a new playlist.
2. Upload / add your custom audio files and arrange them in order.
3. Save the playlist.

### Step 2 — Link the playlist to your genuine MYO card

1. In the **Yoto app**: tap **Library** (bottom) > **Playlists** (top) > open your
   new playlist.
2. Tap **Link to a card** > **Use your phone**.
3. Hold the **genuine MYO card** to the top edge of your phone to link it.

### Step 3 — Copy the link onto your generic card

1. In **NFC Tools**: tap **Write** > **More options** > **Import from NFC tag**.
2. Hold the **genuine MYO card** (now linked) to the top edge of your phone.
   The Yoto playlist URL appears (~45 bytes).
3. Tap **Write / ~45 Bytes**, then hold the **generic (already-formatted) card**
   to the top edge of your phone to write the link.

### Step 4 — Cache the playlist on the player (required for the clone to play)

A byte-perfect clone still shows the red stop sign ("card not recognised") until
the playlist is downloaded onto the target player. The player resolves the card
URL against the cloud by the card's hardware NFC UID; the clone's UID is
unregistered, so the cloud rejects it until the content is already local.

1. With the player **online**, play the playlist (genuine MYO card or Yoto app)
   until every track downloads — no blue streaming-cloud icon; it plays with WiFi off.
2. **Then** insert the clone. It matches the URL to the cached content and plays.

(Do this once per player. A player that has never cached the playlist won't play
the clone until you do.)

**Done.** The generic card now works like any Yoto card.

---

## Adding a NEW playlist on a NEW card

The MYO card is your reusable "staging" card — you overwrite its link each time.

1. **Create the new playlist** (Step 1 above).
2. **Relink the MYO card** to the new playlist (Step 2). This **overwrites the
   URL** on the MYO card so it now points to the new playlist.
3. **Clone MYO → new generic card** (Step 3). Format the blank first only if it
   has never been NDEF-formatted.
4. **Cache the new playlist on the player** (Step 4).

**Your old clones are unaffected.** Each link writes a playlist-specific URL onto
the MYO card; previously cloned cards keep their own URLs, and the Yoto cloud
still maps those to their original playlists. Overwriting the MYO card does not
touch cards you already made — only the MYO card itself now plays the new playlist.

> Sanity check on your first run: after relinking, tap an old clone and confirm it
> still plays its original playlist. If it doesn't, Yoto is reusing one fixed URL
> per card — but the community cloning workflow relies on per-playlist URLs, so
> old clones should stay intact.

---

## Scripted upload: `yoto-upload.js`

Prefer code? `yoto-upload.js` creates (or updates) a Yoto playlist directly from a
folder of MP3s + matching 16×16 PNG icons — no phone, no NFC Tools. Each song becomes
a chapter that displays its own pixel art. **Zero npm dependencies** (Node 18+ built-ins).

### Requirements

- Node.js **18+** (uses global `fetch`, `crypto`, `http`).
- A free Yoto developer app (see Setup).
- Bring your own audio — `*.mp3` files are git-ignored and never shipped in this repo.

### Setup (one-time)

1. At [dashboard.yoto.dev](https://dashboard.yoto.dev), create a **Public** client.
2. Register the redirect URL **exactly**: `http://127.0.0.1:8787/callback`
3. Enable the scopes **`user:content:manage`** and **`offline_access`**, then save.
4. Copy the **Client ID** and export it:
   ```bash
   export YOTO_CLIENT_ID=your_client_id
   ```

### Usage

```bash
node yoto-upload.js example-playlist   # build / update the playlist in <folder>
node yoto-upload.js --reset-auth       # force a fresh browser sign-in
```

The first run opens your browser to sign in to Yoto **once**; the refresh token is
cached in `.yoto-token.json` (git-ignored) so later runs are silent.

A ready-to-copy template lives in [`example-playlist/`](example-playlist/): duplicate
the folder, drop your `.mp3` files in it and your 16×16 PNG icons in `icons/`, then
edit `playlist.json`.

### The manifest — `<folder>/playlist.json`

```json
{
  "cardId": null,
  "title": "My Example Playlist",
  "tracks": [
    { "title": "Track One", "match": "track-one", "icon": "1-track-one.png" }
  ]
}
```

- **`match`** — a distinctive substring used to locate the song's `.mp3` in `<folder>`
  (must match exactly one file).
- **`icon`** — a 16×16 PNG under `<folder>/icons/`.
- **`cardId`** — leave `null`. On the first upload the script fills it in; later runs
  then **update that same playlist** instead of creating a duplicate.

### What it does

For each track: request an upload URL → `PUT` the MP3 → poll until Yoto finishes
transcoding → upload the icon. Then one call assembles the playlist (each song a
chapter, each with its `icon16x16`). Auth is OAuth2 Authorization-Code + PKCE — the
browser sign-in is caught on a local loopback server. The full API/endpoint reference
lives in [`CLAUDE.md`](CLAUDE.md).

---

## Notes

- **Reuse the master card:** the same genuine MYO card can be re-linked to a new
  playlist and copied to as many generic cards as you want.
- **To change a card later:** only repeat **Steps 1–4** (the NDEF format is
  permanent — never needs redoing). See **Adding a NEW playlist on a NEW card** above.
- **Playlist edits sync automatically:** updating audio in a playlist updates
  every card linked to it, with no re-writing.
- Keep your genuine MYO card safe — it's your reusable source for all future cards.

---

## Contributing

Contributions are welcome! See [CONTRIBUTING.md](CONTRIBUTING.md). Please open an
issue first to discuss substantial changes.

## Code of Conduct

This project follows the [Contributor Covenant](CODE_OF_CONDUCT.md). By participating
you agree to uphold a welcoming, harassment-free environment.

## Disclaimer

For **personal use** with audio you own or have the right to use. You are responsible
for respecting the rights of any content you upload. This project is not affiliated
with, authorized, or endorsed by Yoto.

## License

Distributed under the MIT License. See [LICENSE](LICENSE).

## Acknowledgements

- The MYO cloning workflow is based on community guides (r/yoto and similar).
- The scripted tool is built against the official [Yoto Developer API](https://yoto.dev).
- The pixel-art icons shown above are original, hand-designed 16×16 sprites.
