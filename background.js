/* ============================================================
 * NEO-BRUTALIST WORDLE VAULT — background.js
 * ============================================================
 * Lightweight Manifest V3 service worker.
 *
 * It has exactly three tiny jobs (all event-driven, so the worker
 * is unloaded by the browser when idle — zero standing RAM cost):
 *
 *   1. INSTALL/UPDATE  — seeds the storage schema (only when the
 *      vault key is absent; existing data is never clobbered).
 *   2. BADGE SYNC      — mirrors the number of saved words onto
 *      the toolbar icon badge (empty → no badge, 100+ → "99+").
 *   3. STORAGE WATCH   — re-syncs the badge whenever the vault
 *      changes (the popup is the only writer).
 *
 * NOTES
 * -----
 * * No external messages, no alarms, no network requests — the
 *   definition fetch runs in the popup, not here.
 * * This file registers no persistent state, so it can be
 *   terminated and revived by Chrome at any time without data
 *   loss (all durable state lives in chrome.storage.local).
 * * Firefox: MV3 service workers are supported from Firefox 121.
 *   On older Firefox builds the popup still works fully — only
 *   the badge counter is unavailable.
 * ============================================================ */

(function () {
  'use strict';

  /* Must stay in sync with STORAGE_KEY in popup.js. */
  var STORAGE_KEY = 'wordleVault';

  /* Neo-brutalist badge styling: coral bubble, white digits. */
  var BADGE_BG = '#FF5757';
  var BADGE_TEXT = '#FFFFFF';

  /* Fail fast if loaded somewhere without the expected APIs
   * (e.g. a stale browser) instead of throwing mid-install. */
  if (typeof chrome === 'undefined' || !chrome.storage || !chrome.runtime) {
    return;
  }

  /**
   * Reads the vault entry count and paints it onto the action badge.
   * Understands both the current schema ({version, entries}) and the
   * legacy bare-array shape, and fails soft on storage errors.
   */
  function updateBadge() {
    /* chrome.action exists in every MV3 browser; guard anyway so
     * unusual Chromium forks degrade gracefully. */
    if (typeof chrome.action === 'undefined' ||
        typeof chrome.action.setBadgeText !== 'function') {
      return;
    }

    chrome.storage.local.get([STORAGE_KEY], function (result) {
      if (chrome.runtime.lastError) {
        console.warn('[Wordle Vault] badge read failed:', chrome.runtime.lastError.message);
        return;
      }

      var data = result ? result[STORAGE_KEY] : undefined;
      var count = 0;
      if (data && Array.isArray(data.entries)) {
        count = data.entries.length;   // current schema
      } else if (Array.isArray(data)) {
        count = data.length;           // legacy bare-array shape
      }

      var text = count <= 0 ? '' : (count > 99 ? '99+' : String(count));

      try {
        chrome.action.setBadgeText({ text: text });
        chrome.action.setBadgeBackgroundColor({ color: BADGE_BG });
        /* Badge text colour needs Chrome 110+; optional, so it is
         * feature-detected rather than assumed. */
        if (typeof chrome.action.setBadgeTextColor === 'function') {
          chrome.action.setBadgeTextColor({ color: BADGE_TEXT });
        }
      } catch (err) {
        console.warn('[Wordle Vault] badge update failed:', err);
      }
    });
  }

  /**
   * Creates the empty vault object on first install — but only if
   * the key is missing, so updates never overwrite a user's words.
   */
  function seedStorage() {
    chrome.storage.local.get([STORAGE_KEY], function (result) {
      if (chrome.runtime.lastError) { return; }
      if (result && typeof result[STORAGE_KEY] === 'undefined') {
        var payload = {};
        payload[STORAGE_KEY] = { version: 1, entries: [] };
        chrome.storage.local.set(payload);
      }
    });
  }

  /* ---- 1. Install / update: seed schema + paint initial badge ---- */
  chrome.runtime.onInstalled.addListener(function (details) {
    seedStorage();
    updateBadge();
    if (details && details.reason === 'install') {
      console.log('[Wordle Vault] installed — vault ready.');
    }
  });

  /* ---- 2. Browser start: refresh the badge (worker was asleep) ---- */
  chrome.runtime.onStartup.addListener(updateBadge);

  /* ---- 3. Vault changes (written by the popup): re-sync badge ---- */
  chrome.storage.onChanged.addListener(function (changes, areaName) {
    if (areaName === 'local' &&
        changes &&
        Object.prototype.hasOwnProperty.call(changes, STORAGE_KEY)) {
      updateBadge();
    }
  });
}());
