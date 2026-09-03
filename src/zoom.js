// Parses the Zoom participant report into rows with real timestamps.

import { parseCsv } from './csv.js';

const TIME_RE = /^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AP]M)?$/i;

export function parseZoomTime(raw) {
  const s = String(raw || '').trim();
  if (!s) return null;
  const m = TIME_RE.exec(s);
  if (m) {
    let hour = parseInt(m[4], 10);
    const ampm = m[7] ? m[7].toUpperCase() : null;
    if (ampm === 'PM' && hour < 12) hour += 12;
    if (ampm === 'AM' && hour === 12) hour = 0;
    return new Date(
      parseInt(m[3], 10), parseInt(m[1], 10) - 1, parseInt(m[2], 10),
      hour, parseInt(m[5], 10), m[6] ? parseInt(m[6], 10) : 0
    );
  }
  const t = Date.parse(s);
  if (!Number.isNaN(t)) return new Date(t);
  return null;
}

export function dateKey(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return y + '-' + m + '-' + day;
}

export function parseZoomReport(text) {
  const table = parseCsv(text);
  const warnings = [];
  const skipped = [];

  let headerRow = -1;
  for (let i = 0; i < Math.min(table.length, 40); i++) {
    const cells = table[i].map((c) => c.trim().toLowerCase());
    if (cells.some((c) => /name/.test(c)) && cells.some((c) => /join/.test(c))) {
      headerRow = i;
      break;
    }
  }
  if (headerRow < 0) {
    throw new Error('This does not look like a Zoom participant report. Expected columns named Name and Join Time.');
  }
  const header = table[headerRow].map((c) => c.trim().toLowerCase());
  const col = {
    name: header.findIndex((c) => /name/.test(c)),
    email: header.findIndex((c) => /e-?mail/.test(c)),
    join: header.findIndex((c) => /join/.test(c)),
    leave: header.findIndex((c) => /leave/.test(c)),
    duration: header.findIndex((c) => /duration/.test(c)),
  };
  if (col.email < 0) warnings.push('The report has no email column, so matching relies on names only.');

  const rows = [];
  for (let i = headerRow + 1; i < table.length; i++) {
    const cells = table[i];
    const name = (cells[col.name] || '').trim();
    const email = col.email >= 0 ? (cells[col.email] || '').trim() : '';
    const join = parseZoomTime(cells[col.join]);
    const leave = col.leave >= 0 ? parseZoomTime(cells[col.leave]) : null;
    const duration = col.duration >= 0 ? parseFloat(cells[col.duration]) : NaN;

    if (!name && !email) {
      continue;
    }
    if (!join || !leave) {
      skipped.push({ line: i + 1, name, email, reason: 'Could not read the join or leave time.' });
      continue;
    }
    if (leave < join) {
      skipped.push({ line: i + 1, name, email, reason: 'Leave time is before join time.' });
      continue;
    }
    rows.push({
      line: i + 1,
      name,
      email,
      join,
      leave,
      durationMinutes: Number.isNaN(duration) ? null : duration,
    });
  }

  return { rows, warnings, skipped, columns: col };
}

// Most common join date across rows, as YYYY-MM-DD.
export function detectSessionDate(rows) {
  const counts = new Map();
  for (const r of rows) {
    const k = dateKey(r.join);
    counts.set(k, (counts.get(k) || 0) + 1);
  }
  let best = null;
  for (const [k, n] of counts) {
    if (!best || n > best.n) best = { k, n };
  }
  return best ? best.k : null;
}
