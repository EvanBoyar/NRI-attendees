// Page logic: sign-in, roster loading, upload, review, and save.

import { CONFIG } from '../config.js';
import { parseCsv, toCsv } from './csv.js';
import { buildRoster } from './match.js';
import { parseZoomReport, detectSessionDate, dateKey } from './zoom.js';
import { analyze, buildReport } from './score.js';
import { reportRows, reportTitle, FELLOW_HEADER, OTHER_HEADER } from './output.js';
import { initAuth, signIn, signOut, currentToken } from './auth.js';
import { loadRoster, writeReport, listSheets, spreadsheetIdFromInput, fetchUserEmail } from './sheets.js';

const $ = (id) => document.getElementById(id);

const SHEET_KEY = 'nri-attendance-sheet';

const state = {
  userEmail: '',
  spreadsheetId: '',
  roster: null,
  rosterSource: '',
  rosterLabel: '',
  zoom: null,
  fileName: '',
  session: { date: '', start: CONFIG.session.start, end: CONFIG.session.end },
  graceMinutes: CONFIG.session.graceMinutes,
  analysis: null,
  report: null,
  assignments: {},
  filter: 'all',
};

function showError(message) {
  const el = $('error');
  if (!message) {
    el.hidden = true;
    el.textContent = '';
    return;
  }
  el.textContent = message;
  el.hidden = false;
  el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function setText(id, text) {
  $(id).textContent = text;
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ---------- Sign-in and roster ----------

async function handleSignIn() {
  showError('');
  try {
    $('signin-btn').disabled = true;
    setText('signin-status', 'Waiting for Google...');
    const token = await signIn();
    state.userEmail = await fetchUserEmail(token);
    setText('signin-status', state.userEmail ? 'Signed in as ' + state.userEmail : 'Signed in');
    $('signout-btn').hidden = false;
    $('sheet-reload').hidden = false;
    $('signin-btn').hidden = true;
    await loadRosterFromGoogle();
  } catch (e) {
    setText('signin-status', '');
    showError(e.message);
  } finally {
    $('signin-btn').disabled = false;
  }
}

function handleSignOut() {
  signOut();
  state.userEmail = '';
  $('signout-btn').hidden = true;
  $('sheet-reload').hidden = true;
  $('signin-btn').hidden = false;
  setText('signin-status', '');
  if (state.rosterSource === 'google') {
    state.roster = null;
    state.rosterLabel = '';
    setText('roster-status', '');
    recompute();
  }
}

async function loadRosterFromGoogle() {
  const token = currentToken();
  if (!token) {
    showError('Please sign in first.');
    return;
  }
  state.spreadsheetId = spreadsheetIdFromInput($('sheet-url').value);
  if (!state.spreadsheetId) {
    showError('Paste the link to the roster Google Sheet first. It looks like https://docs.google.com/spreadsheets/d/.../edit');
    $('sheet-url').focus();
    return;
  }
  rememberSheet($('sheet-url').value.trim());
  setText('roster-status', 'Loading the roster...');
  try {
    const loaded = await loadRoster(token, state.spreadsheetId, CONFIG.rosterSheetName);
    applyRoster(parseCsvLikeRows(loaded.rows), 'google',
      loaded.spreadsheetTitle + ', tab "' + loaded.sheetTitle + '"');
  } catch (e) {
    setText('roster-status', '');
    showError(e.message);
  }
}

function rememberSheet(value) {
  try {
    if (value) window.localStorage.setItem(SHEET_KEY, value);
    else window.localStorage.removeItem(SHEET_KEY);
  } catch (e) {
    // Storage can be unavailable in private windows. Nothing to do.
  }
}

function recallSheet() {
  try {
    return window.localStorage.getItem(SHEET_KEY) || '';
  } catch (e) {
    return '';
  }
}

function parseCsvLikeRows(rows) {
  return rows.map((r) => r.map((c) => (c === null || c === undefined ? '' : String(c))));
}

function applyRoster(rows, source, label) {
  try {
    state.roster = buildRoster(rows);
  } catch (e) {
    showError(e.message);
    return;
  }
  state.rosterSource = source;
  state.rosterLabel = label;
  const n = state.roster.people.length;
  const enrolled = state.roster.people.filter((p) => p.enrolled).length;
  setText('roster-status',
    'Roster loaded from ' + label + ': ' + n + ' people, ' + enrolled + ' currently enrolled.');
  recompute();
}

function handleRosterFile(ev) {
  const file = ev.target.files && ev.target.files[0];
  if (!file) return;
  showError('');
  const reader = new FileReader();
  reader.onload = () => {
    applyRoster(parseCsv(String(reader.result)), 'csv', 'the file ' + file.name);
  };
  reader.onerror = () => showError('Could not read ' + file.name + '.');
  reader.readAsText(file);
}

// ---------- Zoom upload and session ----------

function handleZoomFile(ev) {
  const file = ev.target.files && ev.target.files[0];
  if (!file) return;
  showError('');
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const parsed = parseZoomReport(String(reader.result));
      state.zoom = parsed;
      state.fileName = file.name;
      const detected = detectSessionDate(parsed.rows);
      state.session.date = detected || state.session.date;
      $('session-date').value = state.session.date;
      $('session-start').value = state.session.start;
      $('session-end').value = state.session.end;
      $('grace').value = state.graceMinutes;
      $('session-box').hidden = false;

      const dates = new Map();
      for (const r of parsed.rows) {
        const k = dateKey(r.join);
        dates.set(k, (dates.get(k) || 0) + 1);
      }
      let msg = 'Read ' + parsed.rows.length + ' rows from ' + file.name + '.';
      if (dates.size > 1) {
        const parts = Array.from(dates.entries()).map(([k, n]) => k + ' (' + n + ' rows)');
        msg += ' The report covers more than one date: ' + parts.join(', ') +
          '. Only rows on the session date are scored.';
      }
      if (parsed.skipped.length > 0) {
        msg += ' ' + parsed.skipped.length + ' rows were skipped because their times could not be read.';
      }
      setText('zoom-status', msg);
      recompute();
    } catch (e) {
      state.zoom = null;
      setText('zoom-status', '');
      showError(e.message);
    }
  };
  reader.onerror = () => showError('Could not read ' + file.name + '.');
  reader.readAsText(file);
}

function readSessionInputs() {
  state.session.date = $('session-date').value || state.session.date;
  state.session.start = $('session-start').value || state.session.start;
  state.session.end = $('session-end').value || state.session.end;
  const g = parseInt($('grace').value, 10);
  state.graceMinutes = Number.isNaN(g) ? state.graceMinutes : g;
}

// ---------- Scoring and rendering ----------

function recompute() {
  if (!state.roster || !state.zoom || !state.session.date) {
    $('step-review').hidden = true;
    $('step-save').hidden = true;
    return;
  }
  readSessionInputs();
  const win = { start: state.session.start, end: state.session.end };
  if (win.start >= win.end) {
    showError('The session end time must be after the start time.');
    return;
  }
  try {
    state.analysis = analyze({ roster: state.roster, zoomRows: state.zoom.rows, session: { ...state.session } });
    state.report = buildReport(state.analysis, state.assignments, state.graceMinutes);
  } catch (e) {
    showError(e.message);
    return;
  }
  renderSummary();
  renderWarnings();
  renderReview();
  renderResults();
  $('step-review').hidden = false;
  $('step-save').hidden = false;
  renderSaveTarget();
}

function renderSummary() {
  const s = state.report.summary;
  const tiles = [
    ['present', s.present, 'Present'],
    ['absent', s.absent, 'Absent'],
    ['', s.notEnrolled, 'Not enrolled'],
    ['review', s.needsReview, 'Need review'],
    ['', s.notOnRoster, 'Not on roster'],
  ];
  $('summary').innerHTML = tiles
    .map(([cls, n, label]) =>
      '<div class="tile ' + cls + '"><div class="n">' + n + '</div><div class="l">' + label + '</div></div>')
    .join('');
}

function renderWarnings() {
  const items = [];
  const r = state.report;
  if (r.summary.offDateRows > 0) {
    items.push(r.summary.offDateRows + ' rows in the report are from a different date and were ignored.');
  }
  for (const w of state.roster.warnings) items.push(w);
  for (const w of state.zoom.warnings) items.push(w);
  if (r.summary.needsReview > 0) {
    items.push(r.summary.needsReview + ' Zoom entries still need a decision below. They will be saved as "Needs review" if you leave them.');
  }
  const el = $('warnings');
  if (items.length === 0) {
    el.hidden = true;
    el.innerHTML = '';
    return;
  }
  el.innerHTML = '<strong>Things to know</strong><ul>' +
    items.map((t) => '<li>' + escapeHtml(t) + '</li>').join('') + '</ul>';
  el.hidden = false;
}

function personLabel(p) {
  return p.name + (p.email ? ' (' + p.email + ')' : '');
}

function reviewIdentities() {
  return state.analysis.identities.filter((id) => id.match.method !== 'email');
}

function renderReview() {
  const tbody = $('review-table').querySelector('tbody');
  const people = state.roster.people;
  const byId = new Map(people.map((p) => [p.id, p]));
  const sortedPeople = people.slice().sort((a, b) => a.name.localeCompare(b.name));
  const items = reviewIdentities();

  if (items.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" class="empty">Everyone in the report matched the roster by email.</td></tr>';
    return;
  }

  const outcomeFor = (id) => {
    const override = state.assignments[id.key];
    let personId = null;
    if (override !== undefined) personId = override === 'guest' ? null : override;
    else personId = id.match.personId;
    if (personId && byId.has(personId)) {
      const f = state.report.fellows.find((x) => x.person.id === personId);
      return { text: f.person.name + ': ' + f.attendance, cls: 'status-' + f.attendance };
    }
    if (override === 'guest' || id.match.method === 'none') return { text: 'Not on roster', cls: '' };
    return { text: 'Needs review', cls: 'review-pending' };
  };

  const html = items.map((id) => {
    const override = state.assignments[id.key];
    const auto = id.match.personId;
    let selected;
    if (override !== undefined) selected = override;
    else if (auto) selected = auto;
    else if (id.match.method === 'none') selected = 'guest';
    else selected = '';

    const seen = new Set();
    const opts = [];
    if (selected === '') opts.push({ v: '', t: 'Choose a person...' });
    if (auto && byId.has(auto)) {
      seen.add(auto);
      opts.push({ v: auto, t: personLabel(byId.get(auto)) + ' (suggested)' });
    }
    for (const c of id.match.candidates) {
      if (seen.has(c.personId) || !byId.has(c.personId)) continue;
      seen.add(c.personId);
      opts.push({ v: c.personId, t: personLabel(byId.get(c.personId)) + (c.reason ? ' (' + c.reason + ')' : '') });
    }
    opts.push({ v: 'guest', t: 'Not a Fellow (guest, staff, or a device)' });
    if (selected && selected !== 'guest' && !seen.has(selected) && byId.has(selected)) {
      opts.push({ v: selected, t: personLabel(byId.get(selected)) });
      seen.add(selected);
    }
    opts.push({ v: 'other', t: 'Someone else on the roster...' });

    const options = opts.map((o) =>
      '<option value="' + escapeHtml(o.v) + '"' + (o.v === selected ? ' selected' : '') + '>' + escapeHtml(o.t) + '</option>'
    ).join('');
    const allOptions = '<option value="">Pick from the roster...</option>' + sortedPeople.map((p) =>
      '<option value="' + p.id + '">' + escapeHtml(personLabel(p)) + '</option>').join('');

    const outcome = outcomeFor(id);
    const rawNames = id.names.length > 1 ? '<div class="raw">Also shown as: ' + escapeHtml(id.names.slice(1).join(', ')) + '</div>' : '';
    return '<tr data-key="' + escapeHtml(id.key) + '">' +
      '<td>' + escapeHtml(id.name) + rawNames + '</td>' +
      '<td>' + escapeHtml(id.email || '') + '</td>' +
      '<td>' + (Math.round(id.secondsInWindow / 6) / 10) + '</td>' +
      '<td><select class="assign">' + options + '</select>' +
      '<select class="assign-other" hidden>' + allOptions + '</select>' +
      (id.match.note ? '<div class="raw">' + escapeHtml(id.match.note) + '</div>' : '') + '</td>' +
      '<td class="' + outcome.cls + '">' + escapeHtml(outcome.text) + '</td>' +
      '</tr>';
  }).join('');
  tbody.innerHTML = html;

  tbody.querySelectorAll('select.assign').forEach((sel) => {
    sel.addEventListener('change', onAssignChange);
  });
  tbody.querySelectorAll('select.assign-other').forEach((sel) => {
    sel.addEventListener('change', onAssignOtherChange);
  });
}

function onAssignChange(ev) {
  const sel = ev.target;
  const tr = sel.closest('tr');
  const key = tr.dataset.key;
  const other = tr.querySelector('select.assign-other');
  if (sel.value === 'other') {
    other.hidden = false;
    other.focus();
    return;
  }
  other.hidden = true;
  setAssignment(key, sel.value);
}

function onAssignOtherChange(ev) {
  const sel = ev.target;
  const tr = sel.closest('tr');
  if (!sel.value) return;
  setAssignment(tr.dataset.key, sel.value);
}

function setAssignment(key, value) {
  const id = state.analysis.identities.find((x) => x.key === key);
  if (!id) return;
  if (value === '' || value === id.match.personId) {
    delete state.assignments[key];
  } else {
    state.assignments[key] = value;
  }
  recompute();
}

function renderResults() {
  const tbody = $('results-table').querySelector('tbody');
  const f = state.filter;
  const rows = state.report.fellows.filter((x) => {
    if (f === 'all') return true;
    if (f === 'notes') return x.notes.length > 0;
    return x.attendance === f;
  });
  if (rows.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" class="empty">Nothing to show.</td></tr>';
    return;
  }
  tbody.innerHTML = rows.map((x) =>
    '<tr>' +
    '<td>' + escapeHtml(x.person.name) + '</td>' +
    '<td>' + escapeHtml(x.person.email) + '</td>' +
    '<td class="status-' + escapeHtml(x.attendance) + '">' + escapeHtml(x.attendance) + '</td>' +
    '<td>' + x.attendedMinutes + '</td>' +
    '<td>' + escapeHtml(x.zoomNames.join('; ')) + '</td>' +
    '<td>' + escapeHtml(x.matchMethod) + '</td>' +
    '<td class="notes">' + escapeHtml(x.notes.join(' ')) + '</td>' +
    '</tr>'
  ).join('');
}

function renderSaveTarget() {
  const title = CONFIG.resultTabPrefix + state.session.date;
  const where = state.rosterSource === 'google'
    ? 'a tab named "' + title + '" in ' + state.rosterLabel.split(', tab')[0]
    : 'a tab named "' + title + '" in the roster Sheet (sign in first)';
  setText('save-target', 'Results will be saved to ' + where + '. If that tab already exists it will be replaced.');
  $('save-btn').disabled = !currentToken() || !state.spreadsheetId;
}

// ---------- Save and download ----------

function buildRows() {
  const meta = {
    fileName: state.fileName,
    generatedAt: new Date().toLocaleString(),
    generatedBy: state.userEmail,
  };
  return reportRows(state.report, meta);
}

function handleDownload() {
  const rows = buildRows();
  const blob = new Blob([toCsv(rows)], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = reportTitle(state.report).replace(/\s+/g, '_') + '.csv';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

async function handleSave() {
  showError('');
  const token = currentToken();
  if (!token) {
    showError('Your Google sign-in has expired. Sign in again, then save.');
    $('signin-btn').hidden = false;
    $('signout-btn').hidden = true;
    return;
  }
  const pending = state.report.summary.needsReview;
  if (pending > 0) {
    const ok = window.confirm(pending + ' Zoom entries still need review. Save anyway and mark them "Needs review" in the Sheet?');
    if (!ok) return;
  }
  const title = CONFIG.resultTabPrefix + state.session.date;
  $('save-btn').disabled = true;
  $('save-result').hidden = true;
  setText('save-status', 'Checking the Sheet...');
  try {
    const info = await listSheets(token, state.spreadsheetId);
    if (info.sheets.some((s) => s.title === title)) {
      const ok = window.confirm('A tab named "' + title + '" already exists in ' + info.title + '. Replace it?');
      if (!ok) {
        setText('save-status', '');
        $('save-btn').disabled = false;
        return;
      }
    }
    setText('save-status', 'Writing results...');
    const rows = buildRows();
    const fellowCount = state.report.fellows.length;
    const boldRows = [0, fellowCount + 2, fellowCount + 3];
    const summaryIndex = rows.findIndex((r) => r.length === 1 && r[0] === 'Summary');
    if (summaryIndex >= 0) boldRows.push(summaryIndex);
    const result = await writeReport(token, state.spreadsheetId, title, rows, {
      boldRows,
      statusColumn: FELLOW_HEADER.indexOf('Attendance'),
      statusRowCount: fellowCount,
      columnCount: Math.max(FELLOW_HEADER.length, OTHER_HEADER.length),
    });
    setText('save-status', '');
    const el = $('save-result');
    el.innerHTML = 'Saved. <a href="' + escapeHtml(result.url) + '" target="_blank" rel="noopener">Open the "' +
      escapeHtml(title) + '" tab in Google Sheets</a>.';
    el.hidden = false;
  } catch (e) {
    setText('save-status', '');
    showError(e.message);
  } finally {
    $('save-btn').disabled = false;
  }
}

// ---------- Startup ----------

function checkSetup() {
  const el = $('setup-warning');
  if (CONFIG.clientId) {
    el.hidden = true;
    return;
  }
  el.textContent = 'This page is not fully set up yet: no Google client ID is set in config.js, so sign-in will not work. See the README for setup steps.';
  el.hidden = false;
}

async function start() {
  checkSetup();
  $('signin-btn').addEventListener('click', handleSignIn);
  $('signout-btn').addEventListener('click', handleSignOut);
  $('sheet-reload').addEventListener('click', loadRosterFromGoogle);
  $('roster-file').addEventListener('change', handleRosterFile);
  $('zoom-file').addEventListener('change', handleZoomFile);
  $('save-btn').addEventListener('click', handleSave);
  $('download-btn').addEventListener('click', handleDownload);
  $('filter').addEventListener('change', (ev) => {
    state.filter = ev.target.value;
    renderResults();
  });
  for (const id of ['session-date', 'session-start', 'session-end', 'grace']) {
    $(id).addEventListener('change', recompute);
  }
  $('session-start').value = state.session.start;
  $('session-end').value = state.session.end;
  $('grace').value = state.graceMinutes;
  $('sheet-url').value = recallSheet();

  if (CONFIG.clientId) {
    try {
      await initAuth(CONFIG.clientId);
    } catch (e) {
      showError(e.message);
    }
  }
}

start();
