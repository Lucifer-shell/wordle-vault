# Neo-Brutalist Wordle Vault

**A zero-dependency Chrome extension (Manifest V3) for collecting your daily Wordle victories.**

Log every solved word — as many per day as you like — into a bold neo-brutalist vault,
then pull up dictionary definitions, phonetics, Wikipedia pages and Hindi translations
without ever leaving the popup.

| | |
| --- | --- |
| **Version** | 1.1.0 (Manifest V3) |
| **Stack** | 100% vanilla HTML + CSS + JS — no Node.js, no npm, no bundler, no frameworks |
| **Size** | ≈ 64 KB on disk · ≈ 23 KB zipped |
| **Permissions** | `storage`, `activeTab` + one host permission (dictionary API) |
| **Privacy** | Words stay on your device; the only network call is the definition lookup you explicitly click |
| **Minimum** | Chrome / Chromium 88+ · Firefox 121+ (full) |

---

## Table of Contents

1. [Screenshots](#screenshots)
2. [Features](#features)
3. [Installation](#installation)
4. [Usage Guide](#usage-guide)
5. [Keyboard Shortcuts](#keyboard-shortcuts)
6. [Project Structure](#project-structure)
7. [Architecture — How It Works](#architecture--how-it-works)
8. [Design System](#design-system)
9. [Data & Storage](#data--storage)
10. [Security & Privacy](#security--privacy)
11. [Compatibility](#compatibility)
12. [Testing](#testing)
13. [Permissions Rationale](#permissions-rationale)
14. [FAQ & Troubleshooting](#faq--troubleshooting)
15. [Uninstalling & Data Removal](#uninstalling--data-removal)
16. [Changelog](#changelog)

---

## Screenshots

**The vault** — words saved as Wordle-style letter tiles, newest first, multiple words per day:

![The Wordle Vault popup with five saved words](docs/popup-vault.png)

**Instant definitions** — phonetics, parts of speech and concise meanings inline:

![A word card with its definition panel open](docs/popup-definition.png)

---

## Features

| Feature | What it does |
| --- | --- |
| **Daily Word Logger** | Type today's solved word and hit `+ SAVE`. **Multiple words per date** are supported — each gets its own card; saving a word already logged today is a no-op. |
| **Vault List** | All saved words as Wordle-style letter tiles on brutalist cards, sorted newest-first, with `TODAY` / `YESTERDAY` / `07 NOV 2026` date chips. Today's entries get an electric-cyan date chip. |
| **Instant Definitions** | `DEFINE` fetches phonetics, parts of speech and up to 4 concise definitions each (max 5 parts of speech) from `api.dictionaryapi.dev` directly inside the popup. Failures show a friendly error plus a `RETRY` button. |
| **Wikipedia** | `WIKI` opens `https://en.wikipedia.org/wiki/{word}` in a new tab. |
| **Hindi Translation** | `TRANSLATE` opens `https://translate.google.com/?sl=en&tl=hi&text={word}&op=translate`. |
| **Search** | Live filter (120 ms debounce) by word **or** date substring — `2026-11` finds every word logged in November. |
| **Delete / Clear** | One-click delete per word; two-step `CLEAR ALL → SURE? CLICK AGAIN` confirm that auto-disarms after 3.5 s. |
| **Badge Counter** | The toolbar icon shows the live word count (`99+` cap) on a coral badge, kept in sync by the background service worker. |
| **Offline-safe** | Everything works offline except the definition fetch, which fails soft with `NETWORK ERROR` / `NO DEFINITION FOUND` and a `RETRY` button. |

---

## Installation

### Chrome / Edge / Brave / Chromium forks (recommended)

1. Download and unzip `wordle-vault-extension.zip` (or copy the `wordle-vault-extension/` folder).
2. Open `chrome://extensions`.
3. Toggle **Developer mode** on (top-right).
4. Click **Load unpacked** and select the `wordle-vault-extension` folder.
5. Pin the extension (puzzle-piece icon → pin) and click the toolbar icon to open the vault.

No restart, no build step, no account, no configuration.

### Firefox

1. Open `about:debugging#/runtime/this-firefox`.
2. Click **Load Temporary Add-on** and pick `manifest.json` inside the folder.
3. Firefox 121+ gets the full experience including the badge counter; on older builds the
   popup works fully — only the badge is unavailable.

### Standalone page mode (zero install)

Open `popup.html` directly in any browser (double-click, or serve the folder with any
static server). The vault runs unchanged and transparently falls back from
`chrome.storage.local` to that browser's `localStorage` — handy for trying it on legacy
machines before installing.

---

## Usage Guide

### Logging words

1. Click the extension icon — the popup opens with the input focused.
2. Type the word you solved (letters only; the field strips anything else, max 15 chars).
3. Press **Enter** or click **+ SAVE**.

Behavior:

- Saving a **new word** adds a card at the top of the vault, chip-labelled `TODAY`.
- Saving the **same word again today** → *"ALREADY SAVED FOR TODAY"* — nothing changes.
- Saving a word you logged on an **earlier date** is allowed; the toast notes
  *"SAVED WORD (ALSO LOGGED YESTERDAY)"* so you can decide whether to keep both.
<img width="400" height="600" alt="popup-vault" src="https://github.com/user-attachments/assets/5565c20c-0f0d-4654-8aad-0adadc62e898" />

### Viewing definitions
<img width="400" height="600" alt="popup-definition" src="https://github.com/user-attachments/assets/5db7146b-57cb-4393-9589-56e1d4ebdaf8" />

Click **DEFINE** on any card. The panel expands inline with the phonetic transcription
(e.g. `/kɹeɪn/`), a yellow part-of-speech chip per meaning group (NOUN, VERB, …), up to
4 definitions per group — italic example sentences when the API has them — and a source
line. Click **HIDE DEF** (same button) to collapse. Long panels scroll internally so the
card stack stays stable. If the word isn't in the dictionary or you're offline, you get
an error message and a **RETRY** button; a successful retry replaces the error in place.

### Wikipedia & translation

**WIKI** and **TRANSLATE** open a real browser tab via `chrome.tabs.create` (the popup
closes automatically). Links carry `rel="noopener noreferrer"` and URL-encoded words.
In standalone page mode they behave as normal safe new-tab links.

### Searching

Type in the **SEARCH** field. Matching is a substring test against the word *and* the
stored ISO date, so `cra` finds *crane*, and `2026-11-06` (or just `11-06`) finds
everything from that day. A `NO MATCHES` panel appears when nothing fits.

### Deleting

- **One word:** click the ✕ on its card → *"DELETED WORD"* toast.
- **Everything:** click **CLEAR ALL** → the button arms (`SURE? CLICK AGAIN`, blinking
  coral) → click again within 3.5 s to wipe the vault. Let the 3.5 s lapse and it
  disarms itself. There is **no undo** — the two-step design is the safety net.

### The badge counter

The toolbar icon's coral badge always mirrors the number of saved words: empty vault →
no badge, 1–99 → the exact count, 100+ → `99+`. It updates on browser start, on
install/update, and instantly whenever the vault changes.

---

## Keyboard Shortcuts

| Key | Action |
| --- | --- |
| `Enter` | Save the word in the input (form submit) |
| `Escape` | Clear the search field first; if empty, close the open definition panel |
| `Tab` | Move between controls — every interactive element has a thick dashed focus ring |

---

## Project Structure

```text
wordle-vault-extension/
├── manifest.json     # MV3 manifest — storage + activeTab only, dictionary host permission
├── popup.html        # Semantic markup, strict CSP declared, no inline script/style
├── styles.css        # Complete neo-brutalist design system (plain non-nested CSS)
├── popup.js          # Storage adapter, sanitizer, rendering, dictionary fetch, actions
├── background.js     # Tiny event-driven service worker (badge sync + schema seeding)
└── icons/            # 16 / 48 / 128 px toolbar icons (hand-drawn brutalist tiles)
```

Total: **8 files, ≈ 64 KB** — deliberately small for low-RAM and legacy machines.

---

## Architecture — How It Works

**popup.js (932 lines, one IIFE, ES5-level syntax)**

- **Storage adapter** — prefers `chrome.storage.local`; falls back to `localStorage` in
  standalone mode. Both expose the same 2-method Promise interface, so nothing else in
  the file knows which one is live.
- **Sanitizer** — every read from storage is re-validated (word `[a-z]{2,15}`, strict
  `YYYY-MM-DD` date, selector-safe id). Corrupt, hand-edited or legacy data is repaired
  or silently dropped; the UI can never be broken by bad storage.
- **Persistence with rollback** — every mutation writes through `commit()`: on write
  failure the in-memory state rolls back to the last known-good snapshot and a
  `STORAGE ERROR` toast appears, so the UI never drifts from disk.
- **Rendering** — a full-repaint model through a `createElement`/`textContent` DOM
  factory (`el()`). No virtual DOM, no diffing — at 400 px wide with a 2,000-entry cap
  it stays instant while keeping the code auditable.
- **Network** — `XMLHttpRequest` with a 10 s timeout (chosen over `fetch` for legacy
  compatibility). Responses are normalized and length-capped before rendering; the
  promise itself is cached per session, so concurrent renders share one request and
  failures stay cached until you hit RETRY.

**background.js (122 lines, event-driven service worker)**

Registers three listeners and holds no state, so Chrome can unload it whenever idle —
zero standing RAM. On install/update it seeds the storage schema *only if the key is
absent* (existing words are never clobbered); on startup and on every storage change it
repaints the badge. That's all it does — no messages, no alarms, no network.

**Why vanilla?** The spec is explicit: no Node/npm/webpack, load directly via *Load
Unpacked*. The code therefore targets ES5 syntax + Promises + XHR, which also buys
compatibility with the legacy browsers the project aims at.

---

## Design System

Neo-brutalism, faithfully executed:

| Token | Value | Used for |
| --- | --- | --- |
| Cream | `#FAF6EE` | Page background |
| Paper | `#FFFFFF` | Cards, inputs |
| Ink | `#000000` | Borders, shadows, text |
| Bright yellow | `#FFDE59` | Primary accent — header, WIKI buttons, POS chips |
| Hot coral | `#FF5757` | Danger accent — delete hover, armed clear-all, errors |
| Electric cyan | `#00FFCC` | Highlight accent — DEFINE buttons, today's chip, success toasts |

- **Borders:** 2 px (tiles, chips) / 3 px (inputs, cards) / 4 px (header, primary buttons), all solid black.
- **Shadows:** hard, zero-blur offsets (`4px 4px 0 #000`) that collapse on click — buttons physically "press into the page".
- **Typography:** system monospace stack — `Courier New`, `Consolas`, `Lucida Console`, `monospace`.
- **Motion:** 60–120 ms micro-transitions only; `prefers-reduced-motion` disables every animation.

**Accessibility**

- Black text on every accent surface — WCAG contrast 6.7:1 (coral) to 16:1 (cyan); white only on pure black.
- Full keyboard operability with unmissable dashed `:focus-visible` rings.
- ARIA: live-region toasts, `aria-expanded` on the DEFINE toggle, labelled buttons and inputs, visually-hidden labels for screen readers.
- Chunky custom scrollbars that keep a 14 px hit area on the vault list and definition panels.

---

## Data & Storage

Everything lives in one key, `wordleVault`, in `chrome.storage.local` (or `localStorage`
in standalone mode). Chrome gives extensions 10 MB of local storage; the vault
self-caps at **2,000 entries (≈ 80 KB)** long before that matters.

```json
{
  "version": 1,
  "entries": [
    { "id": "lx3f2k-9ab1c2", "word": "crane", "date": "2026-11-07", "addedAt": 1762512000000 }
  ]
}
```

- `id` — collision-safe, selector-safe (base36 + dash), regenerated if duplicates are found in stored data.
- `word` — lowercase `a–z`, 2–15 chars.
- `date` — local-timezone `YYYY-MM-DD` (one per calendar day, so `TODAY` is correct even after midnight in another zone).
- `addedAt` — epoch ms, used for ordering same-day entries and duplicate resolution.

**Rules:** multiple entries may share a date (one per word per day — exact word+date
duplicates collapse to the newest). A legacy v1.0 bare-array shape migrates transparently
on first read.

**Inspect / back up your data** (advanced): `chrome://extensions` → Developer mode →
*Neo-Brutalist Wordle Vault* → click **service worker** → Console tab:

```js
chrome.storage.local.get(null, (data) => console.log(JSON.stringify(data, null, 2)));
```

Copy that JSON somewhere safe — it is your vault. Restoring is the mirror image:

```js
chrome.storage.local.set({ wordleVault: { version: 1, entries: [ /* your backup */ ] } });
```

The sanitizer re-validates everything on the next popup open, so slightly imperfect
backups (stale ids, duplicate pairs) are repaired automatically.

---

## Security & Privacy

The extension was built security-first and treats all data — user input, stored state,
API responses — as untrusted:

- **XSS-safe by design.** Every dynamic string is rendered through `textContent`.
  There is **not a single** `innerHTML`, `insertAdjacentHTML` or `document.write` call
  in the codebase, so nothing can ever inject markup or scripts into the popup.
- **Strict CSP.** `popup.html` declares `script-src 'self'` — verified in testing that
  injected inline scripts are blocked outright. Network connections are limited to the
  extension's own origin and the dictionary API.
- **Input validation.** Words are reduced to `[a-z]` (2–15 chars), dates to strict
  `YYYY-MM-DD`, ids to a selector-safe charset — and **re-validated on every read**, so
  corrupt or hand-edited storage can never break the UI.
- **Minimal permissions.** Only `storage` and `activeTab`; the single host permission is
  `https://api.dictionaryapi.dev/*`. No content scripts, no tabs history, no browsing
  data, no remote code — ever.
- **Safe external links.** WIKI/TRANSLATE open with `rel="noopener noreferrer"`
  (blocks tab-nabbing) and URL-encoded parameters.
- **Private by default.** Your words never leave the device except the dictionary lookup
  of a word you explicitly clicked. No analytics, no tracking, no accounts, no remote
  code.
- **Fail-soft storage.** Write failures roll the UI back to the last known-good state;
  reads of corrupt data degrade to an empty vault instead of crashing.
- **Resource-hardened.** Definition payloads are capped (5 parts of speech, 4
  definitions each, 400-char definition / 200-char example truncation), fetches are
  cached per session, requests time out after 10 s, and the vault is capped at 2,000
  entries.

---

## Compatibility

| Environment | Status |
| --- | --- |
| Chrome / Edge / Brave / Chromium 88+ | Fully supported (badge text colour feature-checked for 110+) |
| Firefox 121+ | Fully supported, including the MV3 service worker badge |
| Older Firefox | Popup fully works in standalone/localStorage mode; badge unavailable |
| Legacy engines | ES5 syntax + Promises + XHR, non-nested CSS, no optional chaining / async-await |
| Popup constraints | Fixed 400 px width; vault list scrolls internally to stay under Chrome's 600 px popup limit |

---

## Testing

The build was verified end-to-end in a real browser before shipping, on both storage
paths (`chrome.storage.local` via an API mock, and the `localStorage` fallback):

- **Background worker (6/6):** badge seeding and sync (0 → 3 → `99+` → cleared), two
  words on one date counted correctly, install/update never clobbers an existing vault.
- **Popup:** save, multiple words per day, duplicate no-op, input sanitising
  (`CRANE12!@` → `CRANE`), definition fetch + error/RETRY recovery, exact
  Wikipedia/Translate URLs, delete (one of several same-day words), two-step clear-all
  including the 3.5 s auto-disarm.
- **Data integrity:** seeded corrupt data sanitised correctly (invalid entries dropped,
  exact word+date duplicates collapsed, multiple words per date preserved), persistence
  across reload.
- **Resilience:** offline definition lookups fail soft with a retry path.
- **Layout:** no horizontal overflow at 400 px, all cards in bounds, toast centred,
  **zero console errors** on every page tested.

---

## Permissions Rationale

| Permission | Why it is needed |
| --- | --- |
| `storage` | Persists your vault locally (`chrome.storage.local`). |
| `activeTab` | Keeps the manifest minimal; no deeper tab access is used. |
| `https://api.dictionaryapi.dev/*` | Definition lookups for words you explicitly click. |

Nothing else is requested, and the extension will never ask for more.

---

## FAQ & Troubleshooting

**Why won't my word save?**
Words must be 2–15 letters, `a–z` only. The input strips everything else live — if the
field shows `CRANE` after typing `crane12!@`, that's the sanitizer working. A single
letter or an empty field shows `WORDS MUST BE 2–15 LETTERS`.

**Can I save the same word twice in one day?**
No — the second save is a no-op (`ALREADY SAVED FOR TODAY`). On a *different* day the
same word is allowed, flagged with `ALSO LOGGED …`.

**Definitions say NETWORK ERROR.**
The dictionary is a free public API (`dictionaryapi.dev`); it can be briefly offline or
rate-limited. Check your connection and hit **RETRY**. `NO DEFINITION FOUND` means the
word genuinely isn't in that dictionary (rare for real Wordle answers).

**The badge isn't showing.**
The badge needs MV3 service-worker support — Chrome/Chromium 88+ or Firefox 121+. On
older Firefox builds the popup works but the badge is unavailable by design.

**Where exactly is my data?**
On your machine only, in the extension's `chrome.storage.local` under the key
`wordleVault` — see [Data & Storage](#data--storage) for how to view and back it up.

**I cleared my vault by mistake.**
There is no undo — that's exactly why CLEAR ALL requires a second confirming click
within 3.5 seconds. Restore from a backup (if you made one) via the service-worker
console.

**Can I use it for other daily word games?**
Yes — any 2–15 letter English word saves fine; the definition/wiki/translate utilities
work for all of them.

---

## Uninstalling & Data Removal

1. `chrome://extensions` → *Neo-Brutalist Wordle Vault* → **Remove**.
2. Chrome deletes the extension's `chrome.storage.local` automatically — back up first
   if you want to keep your words (see [Data & Storage](#data--storage)).
3. Standalone-page usage keeps its data in that browser's `localStorage` for the origin
   you opened the page from; clear it via the browser's site-data settings.

---

## Changelog

- **1.1.0** — Multiple words per date: keep saving words throughout the day and each one
  gets its own card (exact word+date duplicates still collapse to the newest). Badge
  counter, search and delete all work across same-day entries.
- **1.0.0** — Initial release: daily logger, vault list, definitions, Wikipedia and
  translation links, badge counter.
