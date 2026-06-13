'use strict';

// ── History tab ───────────────────────────────────────────────────────────────
// Owns: fetching, rendering, and clearing the sync history table.

/**
 * Fetches sync history from the main process and renders it into the history
 * table. Shows the empty-state placeholder when there are no records.
 *
 * @returns {Promise<void>}
 */
async function loadHistory() {
  const history = await window.api.getHistory();
  const tbody   = $('history-body');
  const empty   = $('history-empty');
  tbody.innerHTML = '';

  if (!history || history.length === 0) {
    empty.classList.add('visible');
    return;
  }
  empty.classList.remove('visible');

  history.forEach(entry => renderHistoryRow(tbody, entry));
}

/**
 * Creates and appends a `<tr>` for a single history entry.
 *
 * @param {HTMLTableSectionElement} tbody - The `<tbody>` to append the row to.
 * @param {{ date: string, folder: string, filePath: string, action: 'Overwritten'|'Created' }} entry
 */
function renderHistoryRow(tbody, entry) {
  const tr         = document.createElement('tr');
  const badgeClass = entry.action === 'Overwritten' ? 'badge-overwritten' : 'badge-created';

  // Escape user-supplied text before setting as innerHTML to avoid XSS.
  const safePath   = escapeHtml(entry.filePath);
  const safeFolder = escapeHtml(entry.folder);

  tr.innerHTML = `
    <td style="white-space:nowrap;font-size:12px">${formatDate(entry.date)}</td>
    <td>${safeFolder}</td>
    <td class="filepath-cell" title="${safePath}">${safePath}</td>
    <td><span class="badge ${badgeClass}">${entry.action}</span></td>`;
  tbody.appendChild(tr);
}

/**
 * Escapes HTML special characters in a string to prevent injection when
 * values are inserted via `innerHTML`.
 *
 * @param {string} str - Raw string that may contain HTML characters.
 * @returns {string} Escaped string safe for HTML attribute and text content.
 */
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── Init ──────────────────────────────────────────────────────────────────────

/**
 * Wires up History-tab event listeners. Called once by `renderer.js`.
 * `loadHistory` is also exported so the tab-switching logic can call it
 * whenever the History tab becomes active.
 */
function initHistory() {
  $('btn-clear-history').addEventListener('click', async () => {
    if (!confirm('Clear all sync history?')) return;
    await window.api.clearHistory();
    await loadHistory();
  });
}
