/* ============================================================
 * NEO-BRUTALIST WORDLE VAULT — popup.js
 * ============================================================
 * Responsibilities
 *  1. Daily word logger  — saves today's solved words (multiple
 *     words per date are allowed; re-saving a word already logged
 *     today is a no-op).
 *  2. Vault list view    — chronological cards, newest first,
 *     single-click delete, two-step "clear all", live search.
 *  3. Definition viewer  — fetches phonetics + parts of speech +
 *     concise definitions from api.dictionaryapi.dev on demand.
 *  4. External utilities — Wikipedia & Google-Translate tabs.
 *
 * ENGINEERING / SECURITY NOTES  (read before editing)
 * ------------------------------------------------------------
 * [XSS-SAFE BY DESIGN]
 *  Every dynamic string — user input, stored data, dictionary API
 *  responses — is rendered through `textContent` via the el()
 *  helper. There is not a single innerHTML / insertAdjacentHTML /
 *  document.write call in this file, so nothing can ever inject
 *  markup or scripts into the popup.
 *
 * [INPUT VALIDATION]
 *  Words are reduced to [a-z] only and must be 2–15 characters
 *  (WORD_RE). Dates follow strict YYYY-MM-DD (DATE_RE). Anything
 *  read back from storage is re-sanitised before use — corrupt or
 *  hand-edited data can never break the UI.
 *
 * [LEGACY COMPATIBILITY]
 *  Deliberately conservative JavaScript: ES5-level syntax + Promises
 *  + XMLHttpRequest (no async/await, no optional chaining, no
 *  fetch dependency). The popup therefore ALSO runs when opened
 *  directly in a plain browser (e.g. for quick testing on legacy
 *  machines), where it transparently falls back from
 *  chrome.storage.local to localStorage.
 *
 * [LOW RESOURCE USAGE]
 *  Event delegation (one click listener for the whole list),
 *  per-session definition caching, a hard cap on stored entries,
 *  and single-panel rendering keep the popup light on low-RAM
 *  machines. The background service worker sleeps when idle.
 * ============================================================ */

(function () {
  'use strict';

  /* ============================================================
   * 1. CONFIGURATION
   * ========================================================== */

  var STORAGE_KEY    = 'wordleVault';                 // chrome.storage.local / localStorage key
  var SCHEMA_VERSION = 1;                             // persisted data schema version
  var MAX_ENTRIES    = 2000;                          // hard cap → protects low-RAM machines (~80 KB max)
  var WORD_RE        = /^[a-z]{2,15}$/;               // validated word: letters only, 2–15 chars
  var DATE_RE        = /^\d{4}-\d{2}-\d{2}$/;         // validated date: strict YYYY-MM-DD
  var ID_RE          = /^[a-z0-9-]{1,32}$/i;          // validated entry id (selector-safe charset)

  var DICT_API_BASE  = 'https://api.dictionaryapi.dev/api/v2/entries/en/';
  var WIKI_BASE      = 'https://en.wikipedia.org/wiki/';
  var TRANSLATE_BASE = 'https://translate.google.com/?sl=en&tl=hi&text=';
  var TRANSLATE_TAIL = '&op=translate';

  var FETCH_TIMEOUT_MS     = 10000;   // dictionary request timeout
  var TOAST_MS             = 2600;    // toast auto-dismiss
  var CONFIRM_MS           = 3500;    // "SURE?" armed-state lifetime for clear-all
  var SEARCH_DEBOUNCE_MS   = 120;     // search input debounce
  var MAX_POS_SHOWN        = 5;       // parts of speech shown per word
  var MAX_DEFS_PER_POS     = 4;       // definitions shown per part of speech
  var MAX_DEF_LEN          = 400;     // hard truncate for a definition string
  var MAX_EXAMPLE_LEN      = 200;     // hard truncate for an example sentence

  /* ============================================================
   * 2. DOM SHORTCUTS (script is loaded at the end of <body>,
   *    so every element below already exists)
   * ========================================================== */

  function $(selector) { return document.querySelector(selector); }

  var listEl   = $('#wordList');     // <ul> that holds the word cards
  var emptyEl  = $('#emptyState');   // "vault is empty" block
  var noResEl  = $('#noResults');    // "no search matches" block
  var countEl  = $('#countChip');    // header counter chip
  var formEl   = $('#addForm');      // add-word form
  var inputEl  = $('#wordInput');    // word input field
  var searchEl = $('#searchInput');  // search / filter field
  var clearBtn = $('#clearBtn');     // clear-all button (two-step confirm)
  var toastEl  = $('#toast');        // toast notification element

  /* ============================================================
   * 3. STORAGE ADAPTER
   *    Prefers chrome.storage.local (extension context).
   *    Falls back to localStorage (popup opened as a plain page).
   *    Both paths expose the same tiny Promise-based interface.
   * ========================================================== */

  var storage = (function buildStorage() {
    var hasChromeStorage =
      typeof chrome !== 'undefined' &&
      chrome.storage &&
      chrome.storage.local &&
      typeof chrome.storage.local.get === 'function' &&
      typeof chrome.storage.local.set === 'function';

    if (hasChromeStorage) {
      return {
        kind: 'chrome.storage.local',
        /* Reads the vault object; resolves undefined when absent
         * or unreadable (fail-soft: an empty vault is shown). */
        get: function () {
          return new Promise(function (resolve) {
            chrome.storage.local.get([STORAGE_KEY], function (result) {
              if (chrome.runtime.lastError) {
                console.warn('[Wordle Vault] storage read failed:', chrome.runtime.lastError.message);
                resolve(undefined);
                return;
              }
              resolve(result ? result[STORAGE_KEY] : undefined);
            });
          });
        },
        /* Writes the vault object; rejects on failure so callers
         * can roll back their in-memory state. */
        set: function (value) {
          return new Promise(function (resolve, reject) {
            var payload = {};
            payload[STORAGE_KEY] = value;
            chrome.storage.local.set(payload, function () {
              if (chrome.runtime.lastError) {
                reject(new Error(chrome.runtime.lastError.message));
              } else {
                resolve();
              }
            });
          });
        }
      };
    }

    /* ---- localStorage fallback (plain-browser scenario) ---- */
    return {
      kind: 'localStorage',
      get: function () {
        return new Promise(function (resolve) {
          try {
            var raw = localStorage.getItem(STORAGE_KEY);
            resolve(raw ? JSON.parse(raw) : undefined);
          } catch (err) {
            console.warn('[Wordle Vault] localStorage read failed:', err);
            resolve(undefined);
          }
        });
      },
      set: function (value) {
        return new Promise(function (resolve, reject) {
          try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
            resolve();
          } catch (err) { // quota exceeded / private mode
            reject(err);
          }
        });
      }
    };
  })();

  /* ============================================================
   * 4. MUTABLE STATE
   * ========================================================== */

  var entries        = [];      // sanitised vault entries, newest first
  var lastPersisted  = [];      // snapshot of the last successful write (rollback source)
  var openId         = null;    // id of the entry whose definition panel is open
  var filterText     = '';      // lower-case search filter
  var defCache       = new Map(); // word → Promise<normalisedDefinition> (session cache)
  var toastTimer     = null;    // auto-hide timer for the toast
  var confirmTimer   = null;    // disarm timer for the clear-all button
  var searchTimer    = null;    // debounce timer for the search field

  /* ============================================================
   * 5. SMALL PURE HELPERS
   * ========================================================== */

  /** Collision-safe, selector-safe entry id (base36 + dash). */
  function makeId() {
    return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
  }

  /** Zero-pads a number to two digits ("07"). */
  function pad2(n) { return n < 10 ? '0' + n : String(n); }

  /** Formats a Date as a LOCAL YYYY-MM-DD string (timezone-stable). */
  function toISODate(d) {
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }

  /** Today's date in the user's local timezone. */
  function todayISO() { return toISODate(new Date()); }

  /** Yesterday's date in the user's local timezone. */
  function yesterdayISO() {
    var d = new Date();
    d.setDate(d.getDate() - 1);
    return toISODate(d);
  }

  var MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN',
                'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

  /** Human-friendly date label: TODAY / YESTERDAY / "07 NOV 2026". */
  function friendlyDate(iso) {
    if (iso === todayISO())     return 'TODAY';
    if (iso === yesterdayISO()) return 'YESTERDAY';
    var parts = iso.split('-'); // safe: DATE_RE-validated input
    return parts[2] + ' ' + MONTHS[parseInt(parts[1], 10) - 1] + ' ' + parts[0];
  }

  /**
   * DOM factory — the ONLY way dynamic content enters the page.
   * Uses className + textContent (never innerHTML) so every value
   * is treated as inert text: XSS-safe by construction.
   */
  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) { node.className = className; }
    if (text !== undefined && text !== null) { node.textContent = text; }
    return node;
  }

  /** Lowercases and strips everything except a–z (input sanitiser). */
  function normalizeWord(raw) {
    return String(raw == null ? '' : raw).toLowerCase().replace(/[^a-z]/g, '');
  }

  /* ============================================================
   * 6. VALIDATION & SANITISATION OF PERSISTED DATA
   *    Data is re-validated on every read so corrupt, legacy or
   *    hand-edited storage can never break (or inject into) the UI.
   * ========================================================== */

  /** Sort comparator: newest date first, then most-recently added. */
  function compareEntries(a, b) {
    if (a.date !== b.date) { return a.date < b.date ? 1 : -1; }
    if (a.addedAt !== b.addedAt) { return b.addedAt - a.addedAt; }
    return a.word < b.word ? -1 : 1;
  }

  /**
   * Accepts the raw object read from storage (current schema
   * {version, entries} or a legacy bare array) and returns a clean,
   * sorted, de-duplicated array of valid entries. Multiple entries
   * per date are allowed (one per word); exact word+date duplicates
   * collapse to the most recently added one.
   */
  function sanitizeEntries(raw) {
    var list = [];
    if (raw && typeof raw === 'object') {
      if (Array.isArray(raw)) {                    // legacy bare-array shape
        list = raw;
      } else if (Array.isArray(raw.entries)) {     // current schema
        list = raw.entries;
      }
    }

    var out = [];
    var seen = {};       // word+date → index in `out` (one entry per word per date)
    var idSeen = {};     // guards against duplicate ids in corrupt data

    for (var i = 0; i < list.length; i++) {
      var item = list[i];
      if (!item || typeof item !== 'object') { continue; }

      var word = typeof item.word === 'string' ? item.word.toLowerCase().trim() : '';
      var date = (typeof item.date === 'string' && DATE_RE.test(item.date)) ? item.date : null;
      if (!WORD_RE.test(word) || !date) { continue; } // silently drop invalid entries

      var addedAt = (typeof item.addedAt === 'number' && isFinite(item.addedAt)) ? item.addedAt : 0;
      var id = (typeof item.id === 'string' && ID_RE.test(item.id)) ? item.id : makeId();
      if (idSeen[id]) { id = makeId(); }              // regenerate duplicate ids
      idSeen[id] = true;

      var entry = { id: id, word: word, date: date, addedAt: addedAt };

      /* Multiple entries may share a date (one card per word), but
       * an exact word+date duplicate collapses to the newest. The
       * '\n' separator cannot occur in either validated value. */
      var key = word + '\n' + date;
      var prevIndex = seen[key];
      if (prevIndex === undefined) {
        seen[key] = out.length;
        out.push(entry);
      } else if (addedAt >= out[prevIndex].addedAt) {
        out[prevIndex] = entry; // same word+date → most recently added wins
      }
    }

    if (out.length > MAX_ENTRIES) { out = out.slice(0, MAX_ENTRIES); }
    out.sort(compareEntries);
    return out;
  }

  /* ============================================================
   * 7. PERSISTENCE (load / save with rollback on failure)
   * ========================================================== */

  /** Loads and sanitises the vault from storage. Never rejects. */
  function loadVault() {
    return storage.get().then(function (raw) {
      entries = sanitizeEntries(raw);
      lastPersisted = entries.slice();
    });
  }

  /**
   * Writes the current entries to storage.
   * Rejects when the write fails so callers can roll back.
   */
  function persistVault() {
    var snapshot = { version: SCHEMA_VERSION, entries: entries };
    return storage.set(snapshot).then(function () {
      lastPersisted = entries.slice();
    });
  }

  /**
   * Central "save + repaint" routine used by every mutating action.
   * On storage failure the in-memory state is rolled back to the
   * last known-good snapshot, so the UI can never drift from disk.
   */
  function commit(successToast) {
    return persistVault()
      .then(function () {
        renderAll();
        if (successToast) { showToast(successToast, 'ok'); }
      })
      .catch(function () {
        entries = lastPersisted.slice();
        renderAll();
        showToast('STORAGE ERROR — CHANGE NOT SAVED', 'error');
      });
  }

  /* ============================================================
   * 8. USER ACTIONS
   * ========================================================== */

  /**
   * Logs a word under today's date.
   *  - Multiple words may be saved per date — each gets its own
   *    card in the vault.
   *  - Saving a word that is already logged for today is a no-op
   *    (info toast).
   *  - Saving a word already logged on another date is allowed,
   *    but flagged with an informational toast.
   */
  function addWord(rawWord) {
    var word = normalizeWord(rawWord);

    if (!word) {
      showToast('TYPE A WORD FIRST', 'error');
      return;
    }
    if (!WORD_RE.test(word)) { // only reachable via length now (charset is stripped)
      showToast('WORDS MUST BE 2–15 LETTERS', 'error');
      return;
    }

    var date = todayISO();
    var i;

    /* Same word already logged for today → no-op. */
    for (i = 0; i < entries.length; i++) {
      if (entries[i].date === date && entries[i].word === word) {
        showToast('ALREADY SAVED FOR TODAY', 'info');
        return;
      }
    }

    /* New word for today → its own card (multiple words per date). */
    entries.push({ id: makeId(), word: word, date: date, addedAt: Date.now() });

    /* Informational toast when the word is already logged on an
     * earlier date (allowed, just worth flagging). */
    var dup = null;
    for (i = 0; i < entries.length; i++) {
      if (entries[i].word === word && entries[i].date !== date) { dup = entries[i]; break; }
    }
    var toastMsg = dup
      ? 'SAVED ' + word.toUpperCase() + ' (ALSO LOGGED ' + friendlyDate(dup.date) + ')'
      : 'SAVED ' + word.toUpperCase();

    entries.sort(compareEntries);
    if (entries.length > MAX_ENTRIES) { entries = entries.slice(0, MAX_ENTRIES); }

    /* Reveal the new word: clear any active search filter. */
    filterText = '';
    searchEl.value = '';
    inputEl.value = '';

    commit(toastMsg).then(function () { inputEl.focus(); });
  }

  /** Deletes a single entry by id. */
  function deleteById(id) {
    var removed = null;
    var kept = [];
    for (var i = 0; i < entries.length; i++) {
      if (entries[i].id === id) { removed = entries[i]; }
      else { kept.push(entries[i]); }
    }
    if (!removed) { return; }
    entries = kept;
    if (openId === id) { openId = null; }
    disarmClear();
    commit('DELETED ' + removed.word.toUpperCase());
  }

  /** Deletes every entry (guarded by the two-step confirm button). */
  function clearAll() {
    if (entries.length === 0) {
      showToast('VAULT IS ALREADY EMPTY', 'info');
      return;
    }
    entries = [];
    openId = null;
    defCache.clear(); // free session memory
    commit('VAULT CLEARED');
  }

  /* ============================================================
   * 9. NETWORK — dictionary lookups
   *    XMLHttpRequest is used on purpose: it is supported by every
   *    MV3 browser AND by the legacy browsers covered by the
   *    localStorage fallback, and it natively supports timeouts.
   * ========================================================== */

  /**
   * GETs a URL and parses its JSON body.
   * Resolves with the parsed data, rejects with coded errors:
   *   NOT_FOUND | TIMEOUT | NETWORK | BAD_JSON | HTTP_<status>
   */
  function fetchJSON(url, timeoutMs) {
    return new Promise(function (resolve, reject) {
      var xhr = new XMLHttpRequest();
      xhr.open('GET', url, true);
      xhr.timeout = timeoutMs;

      xhr.onload = function () {
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            resolve(JSON.parse(xhr.responseText));
          } catch (err) {
            reject(new Error('BAD_JSON'));
          }
        } else if (xhr.status === 404) {
          reject(new Error('NOT_FOUND'));
        } else {
          reject(new Error('HTTP_' + xhr.status));
        }
      };
      xhr.onerror   = function () { reject(new Error('NETWORK')); };
      xhr.ontimeout = function () { reject(new Error('TIMEOUT')); };
      xhr.onabort   = function () { reject(new Error('NETWORK')); };

      xhr.send(null);
    });
  }

  /**
   * Validates & normalises a raw dictionaryapi.dev response into
   * { phonetic, meanings:[{pos, definitions:[{definition, example}]}] }.
   * Throws NOT_FOUND when the payload has no usable content.
   * Every field is type-checked and length-capped before rendering.
   */
  function normalizeDefinition(data) {
    if (!Array.isArray(data) || data.length === 0) { throw new Error('NOT_FOUND'); }

    /* ---- phonetic: first non-empty "/…/" transcription ---- */
    var phonetic = '';
    for (var i = 0; i < data.length && !phonetic; i++) {
      var head = data[i];
      if (!head || typeof head !== 'object') { continue; }
      if (typeof head.phonetic === 'string' && head.phonetic.trim()) {
        phonetic = head.phonetic.trim();
        break;
      }
      var phones = head.phonetics;
      if (Array.isArray(phones)) {
        for (var j = 0; j < phones.length; j++) {
          if (phones[j] && typeof phones[j].text === 'string' && phones[j].text.trim()) {
            phonetic = phones[j].text.trim();
            break;
          }
        }
      }
    }

    /* ---- meanings: taken from the first head entry that has them ---- */
    var meanings = [];
    for (var a = 0; a < data.length && meanings.length === 0; a++) {
      var h = data[a];
      if (!h || !Array.isArray(h.meanings)) { continue; }

      for (var b = 0; b < h.meanings.length && meanings.length < MAX_POS_SHOWN; b++) {
        var m = h.meanings[b];
        if (!m || typeof m !== 'object') { continue; }

        var pos = (typeof m.partOfSpeech === 'string' ? m.partOfSpeech : '').trim().toLowerCase();
        var defs = [];
        if (Array.isArray(m.definitions)) {
          for (var c = 0; c < m.definitions.length && defs.length < MAX_DEFS_PER_POS; c++) {
            var d = m.definitions[c];
            if (!d || typeof d.definition !== 'string' || !d.definition.trim()) { continue; }
            var example = (typeof d.example === 'string' && d.example.trim())
              ? d.example.trim().slice(0, MAX_EXAMPLE_LEN)
              : '';
            defs.push({
              definition: d.definition.trim().slice(0, MAX_DEF_LEN),
              example: example
            });
          }
        }
        if (defs.length > 0) {
          meanings.push({ pos: pos || 'other', definitions: defs });
        }
      }
    }

    if (meanings.length === 0) { throw new Error('NOT_FOUND'); }
    return { phonetic: phonetic, meanings: meanings };
  }

  /**
   * Returns a Promise for a word's normalised definition.
   * The PROMISE itself is cached: concurrent renders share one
   * request (no duplicate network calls), and failures stay cached
   * until the user explicitly hits RETRY (which drops the cache).
   */
  function getDefinition(word) {
    if (!defCache.has(word)) {
      var url = DICT_API_BASE + encodeURIComponent(word);
      defCache.set(
        word,
        fetchJSON(url, FETCH_TIMEOUT_MS).then(function (data) {
          return normalizeDefinition(data); // may reject → cached rejection is intended
        })
      );
    }
    return defCache.get(word);
  }

  /** Maps a coded fetch error to a friendly, actionable message. */
  function defErrorMessage(err, word) {
    var code = err && err.message ? err.message : '';
    if (code === 'NOT_FOUND') { return 'NO DEFINITION FOUND FOR \u201C' + word.toUpperCase() + '\u201D'; }
    if (code === 'TIMEOUT')   { return 'REQUEST TIMED OUT — TRY AGAIN'; }
    if (code === 'NETWORK')   { return 'NETWORK ERROR — CHECK YOUR CONNECTION'; }
    return 'COULD NOT LOAD DEFINITION — TRY AGAIN';
  }

  /* ============================================================
   * 10. RENDERING
   *     Everything below builds DOM nodes with createElement +
   *     textContent only. No innerHTML anywhere in this file.
   * ========================================================== */

  /** Full repaint of counter, list and empty/no-result states. */
  function renderAll() {
    /* Header counter (singular/plural aware). */
    countEl.textContent = entries.length + (entries.length === 1 ? ' WORD' : ' WORDS');

    /* Visible cards (respecting the active search filter). */
    var visible = filterText ? entries.filter(matchesFilter) : entries;

    while (listEl.firstChild) { listEl.removeChild(listEl.firstChild); }
    var frag = document.createDocumentFragment();
    for (var i = 0; i < visible.length; i++) {
      frag.appendChild(buildCard(visible[i]));
    }
    listEl.appendChild(frag);

    /* Empty / no-match states. */
    emptyEl.hidden = entries.length !== 0;
    if (entries.length > 0 && visible.length === 0) {
      noResEl.hidden = false;
      noResEl.textContent = 'NO MATCHES FOR \u201C' + filterText.toUpperCase() + '\u201D';
    } else {
      noResEl.hidden = true;
    }

    if (entries.length === 0) { disarmClear(); }
  }

  /** Filter predicate: substring match on word or stored date. */
  function matchesFilter(entry) {
    return entry.word.indexOf(filterText) !== -1 ||
           entry.date.indexOf(filterText) !== -1;
  }

  /** Builds one vault card (<li>) for a saved word. */
  function buildCard(entry) {
    var card = el('li', 'word-card');
    card.dataset.id = entry.id;

    /* ---- top row: letter tiles + date chip + delete button ---- */
    var main = el('div', 'card-main');

    var tiles = el('div', 'word-tiles');
    for (var i = 0; i < entry.word.length; i++) {
      tiles.appendChild(el('span', 'tile', entry.word.charAt(i).toUpperCase()));
    }

    var meta = el('div', 'card-meta');
    meta.appendChild(
      el('span', 'date-chip' + (entry.date === todayISO() ? ' date-chip--today' : ''),
         friendlyDate(entry.date))
    );
    var del = el('button', 'btn-icon', '\u2715'); // ✕
    del.type = 'button';
    del.dataset.action = 'delete';
    del.setAttribute('aria-label', 'Delete ' + entry.word);
    meta.appendChild(del);

    main.appendChild(tiles);
    main.appendChild(meta);
    card.appendChild(main);

    /* ---- action row: DEFINE / WIKI / TRANSLATE ---- */
    var actions = el('div', 'card-actions');
    var isOpen = openId === entry.id;

    var defBtn = el('button', 'btn-action btn-action--define', isOpen ? 'HIDE DEF' : 'DEFINE');
    defBtn.type = 'button';
    defBtn.dataset.action = 'toggle-define';
    defBtn.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
    defBtn.setAttribute('aria-label', 'Definitions for ' + entry.word);

    var wiki = el('a', 'btn-action btn-action--wiki', 'WIKI');
    wiki.href = WIKI_BASE + encodeURIComponent(entry.word); // spec URL
    wiki.target = '_blank';
    wiki.rel = 'noopener noreferrer';                       // blocks tab-nabbing
    wiki.setAttribute('aria-label', 'Open Wikipedia page for ' + entry.word);

    var translate = el('a', 'btn-action btn-action--translate', 'TRANSLATE');
    translate.href = TRANSLATE_BASE + encodeURIComponent(entry.word) + TRANSLATE_TAIL; // spec URL
    translate.target = '_blank';
    translate.rel = 'noopener noreferrer';
    translate.setAttribute('aria-label', 'Translate ' + entry.word + ' to Hindi');

    actions.appendChild(defBtn);
    actions.appendChild(wiki);
    actions.appendChild(translate);
    card.appendChild(actions);

    /* ---- definition panel (only for the open card) ---- */
    if (isOpen) { card.appendChild(buildDefinitionPanel(entry)); }

    return card;
  }

  /**
   * Builds the inline definition panel for a card.
   * If a cached (or in-flight) definition exists it is reused;
   * otherwise a loading state is shown and the fetch is started.
   * The async fill is guarded twice: the panel must still be the
   * open one (openId) and its card must still be connected to the
   * document — this makes stale responses harmless.
   */
  function buildDefinitionPanel(entry) {
    var panel = el('div', 'def-panel');
    panel.setAttribute('role', 'region');
    panel.setAttribute('aria-label', 'Definitions for ' + entry.word);

    var loading = el('div', 'def-loading');
    loading.appendChild(el('span', 'def-spinner'));
    loading.appendChild(el('span', null, 'FETCHING DEFINITION\u2026'));
    panel.appendChild(loading);

    getDefinition(entry.word)
      .then(function (def) {
        if (openId !== entry.id) { return; }          // user moved on
        var card = findCard(entry.id);
        if (!card) { return; }                        // card was removed
        var live = card.querySelector('.def-panel');
        if (live) { fillPanelContent(live, def); }
      })
      .catch(function (err) {
        if (openId !== entry.id) { return; }
        var card = findCard(entry.id);
        if (!card) { return; }
        var live = card.querySelector('.def-panel');
        if (live) { fillPanelError(live, entry, err); }
      });

    return panel;
  }

  /** Renders a successful definition payload into a panel. */
  function fillPanelContent(panel, def) {
    while (panel.firstChild) { panel.removeChild(panel.firstChild); }

    if (def.phonetic) {
      panel.appendChild(el('p', 'def-phonetic', def.phonetic));
    }

    for (var i = 0; i < def.meanings.length; i++) {
      var meaning = def.meanings[i];

      var section = el('div', 'def-meaning');
      section.appendChild(el('span', 'pos-chip', meaning.pos.toUpperCase()));

      var list = el('ul', 'def-list');
      for (var j = 0; j < meaning.definitions.length; j++) {
        var item = meaning.definitions[j];
        var li = el('li', 'def-item');
        li.appendChild(el('span', 'def-text', item.definition));
        if (item.example) {
          li.appendChild(el('span', 'def-example', '\u201C' + item.example + '\u201D'));
        }
        list.appendChild(li);
      }
      section.appendChild(list);
      panel.appendChild(section);
    }

    panel.appendChild(el('p', 'def-source', 'SOURCE: DICTIONARYAPI.DE'));

    /* The panel just grew — make sure its bottom is on screen. */
    if (panel.parentNode) { ensureCardVisible(panel.parentNode); }
  }

  /** Renders an error state (with a RETRY button) into a panel. */
  function fillPanelError(panel, entry, err) {
    while (panel.firstChild) { panel.removeChild(panel.firstChild); }
    panel.appendChild(el('p', 'def-error', defErrorMessage(err, entry.word)));

    var retry = el('button', 'btn-action btn-action--retry', 'RETRY');
    retry.type = 'button';
    retry.dataset.action = 'retry-define';
    panel.appendChild(retry);
  }

  /** Finds a rendered card by entry id (ids are selector-safe). */
  function findCard(id) {
    return listEl.querySelector('.word-card[data-id="' + id + '"]');
  }

  /**
   * Scrolls the vault list just enough to fully reveal a card —
   * called when a definition panel opens or finishes loading, so
   * content below the fold is never silently cut off. Uses the
   * modern options form; ancient engines ignore it harmlessly.
   */
  function ensureCardVisible(card) {
    if (card && typeof card.scrollIntoView === 'function') {
      try {
        card.scrollIntoView({ block: 'nearest' });
      } catch (err) {
        card.scrollIntoView(false);
      }
    }
  }

  /* ============================================================
   * 11. TOASTS (single reusable status bubble)
   * ========================================================== */

  function showToast(message, type) {
    toastEl.textContent = message;
    toastEl.className = 'toast toast--' + (type || 'info');
    toastEl.hidden = false;
    if (toastTimer) { clearTimeout(toastTimer); }
    toastTimer = setTimeout(function () { toastEl.hidden = true; }, TOAST_MS);
  }

  /* ============================================================
   * 12. TWO-STEP "CLEAR ALL" CONFIRMATION
   *     First click arms the button ("SURE? CLICK AGAIN"),
   *     second click within CONFIRM_MS wipes the vault.
   *     Uses an inline pattern instead of window.confirm so the
   *     popup keeps its Neo-Brutalist chrome.
   * ========================================================== */

  function isClearArmed() { return clearBtn.classList.contains('is-armed'); }

  function armClear() {
    clearBtn.classList.add('is-armed');
    clearBtn.textContent = 'SURE? CLICK AGAIN';
    if (confirmTimer) { clearTimeout(confirmTimer); }
    confirmTimer = setTimeout(disarmClear, CONFIRM_MS);
  }

  function disarmClear() {
    if (confirmTimer) { clearTimeout(confirmTimer); confirmTimer = null; }
    clearBtn.classList.remove('is-armed');
    clearBtn.textContent = 'CLEAR ALL';
  }

  /* ============================================================
   * 13. DEFINITION PANEL TOGGLING
   * ========================================================== */

  function toggleDefinition(id) {
    openId = (openId === id) ? null : id;
    renderAll();
    /* Reveal the freshly opened panel if it sits below the fold. */
    if (openId !== null) {
      ensureCardVisible(findCard(id));
    }
  }

  function retryDefinition(id) {
    var entry = null;
    for (var i = 0; i < entries.length; i++) {
      if (entries[i].id === id) { entry = entries[i]; break; }
    }
    if (!entry) { return; }
    defCache.delete(entry.word); // drop the cached rejection → refetch
    renderAll();                 // openId unchanged → panel rebuilds + refetches
  }

  /* ============================================================
   * 14. EVENT WIRING
   * ========================================================== */

  /* ---- save form: submit (Enter key or "+ SAVE" button) ---- */
  formEl.addEventListener('submit', function (e) {
    e.preventDefault(); // never navigate; all logic stays in-page
    addWord(inputEl.value);
  });

  /* ---- word input: live sanitising (letters only, max 15) ---- */
  inputEl.addEventListener('input', function () {
    var cleaned = inputEl.value.replace(/[^a-zA-Z]/g, '').slice(0, 15);
    if (cleaned !== inputEl.value) { inputEl.value = cleaned; }
  });

  /* ---- search field: debounced filtering ---- */
  searchEl.addEventListener('input', function () {
    if (searchTimer) { clearTimeout(searchTimer); }
    searchTimer = setTimeout(function () {
      filterText = searchEl.value.trim().toLowerCase();
      renderAll();
    }, SEARCH_DEBOUNCE_MS);
  });

  /* ---- clear-all button: two-step confirm ---- */
  clearBtn.addEventListener('click', function () {
    if (entries.length === 0) {
      showToast('VAULT IS ALREADY EMPTY', 'info');
      return;
    }
    if (isClearArmed()) {
      disarmClear();
      clearAll();
    } else {
      armClear();
    }
  });

  /* ---- Escape: clears the search first, else closes the panel ---- */
  document.addEventListener('keydown', function (e) {
    var key = e.key || '';
    if (key === 'Escape' || e.keyCode === 27) {
      if (searchEl.value) {
        searchEl.value = '';
        filterText = '';
        renderAll();
        searchEl.focus();
      } else if (openId !== null) {
        openId = null;
        renderAll();
      }
    }
  });

  /* ---- vault list: ONE delegated click listener for all cards ---- */
  listEl.addEventListener('click', function (e) {
    var target = e.target;
    if (!target || typeof target.closest !== 'function') { return; }

    var actionEl = target.closest('[data-action]');
    if (!actionEl || !listEl.contains(actionEl)) { return; }

    var card = actionEl.closest('.word-card');
    if (!card) { return; }

    var id = card.dataset.id || '';
    var action = actionEl.dataset.action;

    if (action === 'toggle-define')      { toggleDefinition(id); }
    else if (action === 'retry-define')  { retryDefinition(id); }
    else if (action === 'delete')        { deleteById(id); }
  });

  /* ---- external links: open real tabs when chrome.tabs exists.
   * In the extension popup this opens a proper browser tab and
   * closes the popup. In the plain-browser fallback the default
   * anchor behaviour (target=_blank + noopener) takes over. ---- */
  document.addEventListener('click', function (e) {
    var target = e.target;
    if (!target || typeof target.closest !== 'function') { return; }

    var anchor = target.closest('a[target="_blank"]');
    if (!anchor) { return; }

    if (typeof chrome !== 'undefined' && chrome.tabs && typeof chrome.tabs.create === 'function') {
      try {
        chrome.tabs.create({ url: anchor.href, active: true });
        e.preventDefault();
      } catch (err) {
        /* fall through to the default anchor behaviour */
      }
    }
  });

  /* ============================================================
   * 15. BOOTSTRAP
   * ========================================================== */

  loadVault()
    .catch(function () { // defensive: loadVault itself is fail-soft
      entries = [];
      lastPersisted = [];
    })
    .then(function () {
      renderAll();
      inputEl.focus();
    });

  /* Expose nothing to the global scope — the popup surface stays
   * minimal and cannot be poked at from other scripts. */
}());
