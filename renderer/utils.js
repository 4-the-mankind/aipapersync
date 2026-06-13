'use strict';

/**
 * Returns the DOM element with the given id.
 * Thin wrapper around `document.getElementById` to reduce boilerplate.
 *
 * @param {string} id - The element id to look up.
 * @returns {HTMLElement | null}
 */
function $(id) {
  return document.getElementById(id);
}

/**
 * Formats an ISO 8601 date string into the locale-aware short date-time
 * format understood by the current system locale.
 * Falls back to the raw string if parsing fails.
 *
 * @param {string} iso - ISO 8601 date string (e.g. "2024-06-13T14:22:00.000Z").
 * @returns {string} Human-readable date/time string.
 */
function formatDate(iso) {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}
