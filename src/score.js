// Groups Zoom rows into identities, runs the matcher, and scores attendance.

import { normalizeEmail, nameKey, cleanDisplayName } from './names.js';
import { matchIdentity } from './match.js';
import { dateKey } from './zoom.js';

export function sessionWindow(session) {
  const [y, mo, d] = session.date.split('-').map((n) => parseInt(n, 10));
  const [sh, sm] = session.start.split(':').map((n) => parseInt(n, 10));
  const [eh, em] = session.end.split(':').map((n) => parseInt(n, 10));
  const start = new Date(y, mo - 1, d, sh, sm, 0);
  const end = new Date(y, mo - 1, d, eh, em, 0);
  return { start, end, seconds: (end - start) / 1000 };
}

export function mergeIntervals(intervals) {
  // Accepts either {start, end} or Zoom rows shaped {join, leave}.
  const sorted = intervals
    .map((iv) => ({ start: iv.start || iv.join, end: iv.end || iv.leave }))
    .sort((a, b) => a.start - b.start);
  const out = [];
  for (const iv of sorted) {
    const last = out[out.length - 1];
    if (last && iv.start <= last.end) {
      if (iv.end > last.end) last.end = iv.end;
    } else {
      out.push({ start: iv.start, end: iv.end });
    }
  }
  return out;
}

export function secondsInWindow(intervals, win) {
  let total = 0;
  for (const iv of mergeIntervals(intervals)) {
    const s = Math.max(iv.start.getTime(), win.start.getTime());
    const e = Math.min(iv.end.getTime(), win.end.getTime());
    if (e > s) total += (e - s) / 1000;
  }
  return total;
}

function identityKeyFor(row) {
  const e = normalizeEmail(row.email);
  if (e) return 'email:' + e;
  return 'name:' + (nameKey(row.name) || row.name.trim().toLowerCase());
}

// Groups Zoom rows into identities (one per email, or per name when there is
// no email), filters to the session date, and matches each identity.
export function analyze({ roster, zoomRows, session }) {
  const win = sessionWindow(session);
  const onDate = [];
  const offDate = [];
  for (const row of zoomRows) {
    if (dateKey(row.join) === session.date) onDate.push(row);
    else offDate.push(row);
  }

  const identities = new Map();
  for (const row of onDate) {
    const key = identityKeyFor(row);
    if (!identities.has(key)) {
      identities.set(key, {
        key,
        name: row.name,
        displayName: cleanDisplayName(row.name) || row.name,
        email: row.email,
        rows: [],
        names: new Set(),
      });
    }
    const id = identities.get(key);
    id.rows.push(row);
    id.names.add(row.name);
  }

  const list = [];
  for (const id of identities.values()) {
    id.match = matchIdentity({ name: id.name, email: id.email }, roster);
    id.secondsInWindow = secondsInWindow(id.rows, win);
    id.firstJoin = new Date(Math.min(...id.rows.map((r) => r.join.getTime())));
    id.lastLeave = new Date(Math.max(...id.rows.map((r) => r.leave.getTime())));
    id.names = Array.from(id.names);
    list.push(id);
  }
  list.sort((a, b) => a.firstJoin - b.firstJoin);

  // Remember which roster emails only appear on other dates, so the report
  // can say so instead of leaving staff to wonder.
  const offDateByEmail = new Map();
  for (const row of offDate) {
    const e = normalizeEmail(row.email);
    if (!e) continue;
    if (!offDateByEmail.has(e)) offDateByEmail.set(e, new Set());
    offDateByEmail.get(e).add(dateKey(row.join));
  }

  return { roster, session, window: win, identities: list, offDate, offDateByEmail };
}

function minutes(seconds) {
  return Math.round((seconds / 60) * 10) / 10;
}

const METHOD_LABELS = {
  email: 'Email',
  name: 'Name',
  nickname: 'Name (short form)',
  typo: 'Name (spelling differs)',
  staff: 'Assigned by staff',
};

// assignments: { [identityKey]: personId | 'guest' }
export function buildReport(analysis, assignments = {}, graceMinutes = 10) {
  const { roster, window: win, identities, session } = analysis;
  const graceSeconds = graceMinutes * 60;
  const byPerson = new Map();
  for (const p of roster.people) {
    byPerson.set(p.id, { person: p, identities: [] });
  }

  const others = [];
  for (const id of identities) {
    const override = assignments[id.key];
    let personId = null;
    let method = id.match.method;
    if (override !== undefined) {
      personId = override === 'guest' ? null : override;
      method = override === 'guest' ? 'guest' : 'staff';
    } else if (id.match.personId) {
      personId = id.match.personId;
    }
    if (personId && byPerson.has(personId)) {
      byPerson.get(personId).identities.push({ identity: id, method });
    } else {
      others.push({
        identity: id,
        status: override === 'guest' ? 'Not on roster' : (id.match.method === 'review' ? 'Needs review' : 'Not on roster'),
        minutes: minutes(id.secondsInWindow),
        note: override === 'guest' ? 'Marked as not a Fellow by staff.' : id.match.note,
      });
    }
  }

  const pendingByPerson = new Map();
  for (const o of others) {
    if (o.status !== 'Needs review') continue;
    for (const c of o.identity.match.candidates) {
      if (!pendingByPerson.has(c.personId)) pendingByPerson.set(c.personId, []);
      pendingByPerson.get(c.personId).push(o.identity.displayName);
    }
  }

  const fellows = [];
  for (const p of roster.people) {
    const entry = byPerson.get(p.id);
    const rows = entry.identities.flatMap((x) => x.identity.rows);
    const attendedSeconds = secondsInWindow(rows, win);
    const missedSeconds = Math.max(0, win.seconds - attendedSeconds);
    const notes = [...p.notes];
    const zoomNames = Array.from(new Set(entry.identities.flatMap((x) => x.identity.names)));

    for (const x of entry.identities) {
      if (x.identity.match.note && x.method !== 'staff') notes.push(x.identity.match.note);
      if (x.identity.rows.length > 1) {
        notes.push('Joined ' + x.identity.rows.length + ' times; time in the room was added together.');
      }
    }
    if (entry.identities.length > 1) {
      notes.push('Matched from ' + entry.identities.length + ' Zoom entries.');
    }
    if (rows.length === 0 && analysis.offDateByEmail && analysis.offDateByEmail.has(p.emailKey)) {
      notes.push('Appears in the report only on ' +
        Array.from(analysis.offDateByEmail.get(p.emailKey)).join(', ') + ', not on the session date.');
    }
    const pending = pendingByPerson.get(p.id);
    if (pending && rows.length === 0) {
      notes.push('A Zoom entry that might be this person is waiting for review: ' + pending.join(', ') + '.');
    }

    let attendance;
    if (!p.enrolled) {
      attendance = 'Not enrolled';
    } else if (rows.length === 0) {
      attendance = 'Absent';
    } else {
      attendance = missedSeconds > graceSeconds ? 'Absent' : 'Present';
    }

    const methods = Array.from(new Set(entry.identities.map((x) => METHOD_LABELS[x.method] || x.method)));

    fellows.push({
      person: p,
      attendance,
      attendedMinutes: minutes(attendedSeconds),
      missedMinutes: minutes(missedSeconds),
      inReport: rows.length > 0,
      zoomNames,
      matchMethod: rows.length === 0 ? 'Not found in Zoom report' : methods.join('; '),
      notes,
    });
  }

  const summary = {
    present: fellows.filter((f) => f.attendance === 'Present').length,
    absent: fellows.filter((f) => f.attendance === 'Absent').length,
    notEnrolled: fellows.filter((f) => f.attendance === 'Not enrolled').length,
    needsReview: others.filter((o) => o.status === 'Needs review').length,
    notOnRoster: others.filter((o) => o.status === 'Not on roster').length,
    offDateRows: analysis.offDate.length,
    rosterCount: fellows.length,
  };

  return { fellows, others, summary, session, window: win, graceMinutes, offDate: analysis.offDate };
}
