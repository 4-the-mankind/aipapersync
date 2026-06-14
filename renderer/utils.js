'use strict';

/**
 * Returns the DOM element with the given id.
 * @param {string} id
 * @returns {HTMLElement | null}
 */
function $(id) {
  return document.getElementById(id);
}

/**
 * Formats an ISO 8601 date string into the locale-aware short date-time format.
 * Falls back to the raw string if parsing fails.
 * @param {string} iso
 * @returns {string}
 */
function formatDate(iso) {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

// ── Toast ─────────────────────────────────────────────────────────────────────

/** @type {ReturnType<typeof setTimeout> | null} */
let _toastTimer = null;

/**
 * Shows a brief toast notification in the bottom-right corner.
 * Safe to call repeatedly — each call resets the hide timer.
 * @param {string} msg
 */
function showToast(msg) {
  const toast = $('save-toast');
  toast.textContent = msg;
  toast.classList.add('visible');
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => toast.classList.remove('visible'), 2000);
}
