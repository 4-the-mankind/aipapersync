'use strict';

// ── History tab ───────────────────────────────────────────────────────────────
// Owns: fetching, rendering, paginating, and clearing the sync history table.

const PAGE_SIZE = 50;

/** @type {Array} Full history array, newest-first. */
let _history = [];

/** @type {number} Current page index (0-based). */
let _page = 0;

/**
 * Fetches sync history from the main process, stores it, and renders page 0.
 * @returns {Promise<void>}
 */
async function loadHistory() {
  _history = (await window.api.getHistory()) || [];
  _history = _history.slice().reverse(); // newest first
  _page = 0;
  renderPage();
}

/**
 * Renders the current page into the table and updates pagination controls.
 */
function renderPage() {
  const tbody = $('history-body');
  const empty = $('history-empty');
  tbody.innerHTML = '';

  if (_history.length === 0) {
    empty.classList.add('visible');
    $('history-pagination').style.display = 'none';
    return;
  }
  empty.classList.remove('visible');

  const totalPages = Math.ceil(_history.length / PAGE_SIZE);
  const start      = _page * PAGE_SIZE;
  const slice      = _history.slice(start, start + PAGE_SIZE);

  slice.forEach(entry => renderHistoryRow(tbody, entry));

  // Pagination controls
  const pager = $('history-pagination');
  pager.style.display = totalPages > 1 ? 'flex' : 'none';
  $('page-info').textContent  = `Page ${_page + 1} / ${totalPages}`;
  $('btn-page-prev').disabled = _page === 0;
  $('btn-page-next').disabled = _page >= totalPages - 1;
}

/**
 * Creates and appends a `<tr>` for a single history entry.
 * @param {HTMLTableSectionElement} tbody
 * @param {{ date: string, folder: string, filePath: string, action: 'Overwritten'|'Created' }} entry
 */
function renderHistoryRow(tbody, entry) {
  const tr         = document.createElement('tr');
  const badgeClass = entry.action === 'Overwritten' ? 'badge-overwritten'
                   : entry.action === 'Deleted'    ? 'badge-deleted'
                   :                                 'badge-created';
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
 * Escapes HTML special characters in a string.
 * @param {string} str
 * @returns {string}
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
 */
function initHistory() {
  $('btn-clear-history').addEventListener('click', async () => {
    if (!confirm('Clear all sync history?')) return;
    await window.api.clearHistory();
    await loadHistory();
  });

  $('btn-page-prev').addEventListener('click', () => {
    if (_page > 0) { _page--; renderPage(); }
  });

  $('btn-page-next').addEventListener('click', () => {
    if (_page < Math.ceil(_history.length / PAGE_SIZE) - 1) { _page++; renderPage(); }
  });
}
