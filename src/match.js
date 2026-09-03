// Builds the roster from sheet rows and matches Zoom identities to Fellows.

import {
  nameKey, nameString, nameTokens, canonicalToken, editDistance, normalizeEmail,
} from './names.js';

const ENROLLED_PATTERN = /^(active|enrolled|current|yes)?$/i;

function findHeaderRow(rows, required) {
  for (let i = 0; i < Math.min(rows.length, 30); i++) {
    const cells = rows[i].map((c) => String(c).trim().toLowerCase());
    if (required.every((re) => cells.some((c) => re.test(c)))) {
      return i;
    }
  }
  return -1;
}

function columnIndex(headerCells, re) {
  return headerCells.findIndex((c) => re.test(c));
}

export function buildRoster(rows) {
  const warnings = [];
  const headerRow = findHeaderRow(rows, [/name/, /e-?mail/]);
  if (headerRow < 0) {
    throw new Error('Could not find a header row with a Name column and an Email column in the roster.');
  }
  const header = rows[headerRow].map((c) => String(c).trim().toLowerCase());
  const col = {
    name: columnIndex(header, /name/),
    email: columnIndex(header, /e-?mail/),
    status: columnIndex(header, /status/),
    cohort: columnIndex(header, /cohort/),
  };

  const people = [];
  const byEmail = new Map();
  const byNameKey = new Map();

  for (let r = headerRow + 1; r < rows.length; r++) {
    const row = rows[r];
    const name = String(row[col.name] || '').trim();
    const email = String(row[col.email] || '').trim();
    if (!name && !email) continue;
    const status = col.status >= 0 ? String(row[col.status] || '').trim() : '';
    const cohort = col.cohort >= 0 ? String(row[col.cohort] || '').trim() : '';
    const emailKey = normalizeEmail(email);
    const sheetRow = r + 1;

    if (emailKey && byEmail.has(emailKey)) {
      const existing = byEmail.get(emailKey);
      existing.duplicateRows.push(sheetRow);
      if (status && !existing.statuses.includes(status)) {
        existing.statuses.push(status);
      }
      if (name && name !== existing.name && !existing.altNames.includes(name)) {
        existing.altNames.push(name);
      }
      continue;
    }

    const person = {
      id: 'p' + (people.length + 1),
      name,
      email,
      emailKey,
      cohort,
      statuses: status ? [status] : [],
      sheetRow,
      duplicateRows: [],
      altNames: [],
      nameKey: nameKey(name),
      nameStr: nameString(name),
      tokens: nameTokens(name).map(canonicalToken),
      rawTokens: nameTokens(name),
      sameNameAs: [],
      notes: [],
    };
    people.push(person);
    if (emailKey) byEmail.set(emailKey, person);
    if (person.nameKey) {
      if (!byNameKey.has(person.nameKey)) byNameKey.set(person.nameKey, []);
      byNameKey.get(person.nameKey).push(person);
    }
  }

  for (const person of people) {
    const statuses = person.statuses;
    const enrolledVotes = statuses.map((s) => ENROLLED_PATTERN.test(s));
    person.enrolled = statuses.length === 0 ? true : enrolledVotes.some(Boolean);
    person.status = statuses.length === 0 ? '' : statuses.join(' / ');
    if (statuses.length > 1) {
      person.status = 'Conflict: ' + statuses.join(' / ');
      person.notes.push(
        'Roster lists this email more than once with different statuses (' + statuses.join(', ') +
        '). Scored as enrolled. Please fix the roster.'
      );
      warnings.push(person.name + ' appears more than once in the roster with different statuses.');
    } else if (person.duplicateRows.length > 0) {
      person.notes.push('Roster lists this email more than once (rows ' +
        [person.sheetRow, ...person.duplicateRows].join(', ') + ').');
    }
    if (person.altNames.length > 0) {
      person.notes.push('Roster also lists this email under the name ' + person.altNames.join(', ') + '.');
    }
    const sameName = (byNameKey.get(person.nameKey) || []).filter((p) => p !== person);
    if (sameName.length > 0) {
      person.sameNameAs = sameName.map((p) => p.id);
      person.notes.push('Another roster entry has the same name (row ' +
        sameName.map((p) => p.sheetRow).join(', ') + '). Zoom rows without an email cannot be assigned automatically.');
    }
    if (!person.emailKey) {
      person.notes.push('No email on the roster.');
    }
  }

  return { people, warnings, headerRow, columns: col };
}

function candidateScore(identityTokens, identityStr, identityKey, person) {
  const reasons = [];
  let score = Infinity;

  if (person.nameStr) {
    const dOrdered = editDistance(identityStr, person.nameStr);
    const dSorted = editDistance(identityKey, person.nameKey);
    const d = Math.min(dOrdered, dSorted);
    if (d <= 3) {
      score = d;
      reasons.push(d === 0 ? 'same name' : 'similar spelling');
    }
  }

  const single = identityTokens.filter((t) => t.length === 1);
  const longer = identityTokens.filter((t) => t.length > 1);
  if (single.length > 0 && longer.length > 0 && person.tokens.length >= 2) {
    const first = person.tokens[0];
    const last = person.tokens[person.tokens.length - 1];
    const firstOk = longer.some((t) => first.startsWith(t) || t.startsWith(first));
    const lastOk = single.some((t) => last.startsWith(t));
    if (firstOk && lastOk) {
      score = Math.min(score, 2.5);
      reasons.push('initials match');
    }
  }

  if (identityTokens.length >= 1 && person.tokens.length >= 2) {
    const first = person.tokens[0];
    const last = person.tokens[person.tokens.length - 1];
    if (identityTokens.includes(last) && !identityTokens.includes(first)) {
      score = Math.min(score, 4);
      reasons.push('same last name');
    } else if (identityTokens.includes(first) && !identityTokens.includes(last)) {
      score = Math.min(score, 5);
      reasons.push('same first name');
    }
  }

  return { score, reasons };
}

// identity: { name, email }
export function matchIdentity(identity, roster) {
  const emailKey = normalizeEmail(identity.email);
  const result = {
    personId: null,
    method: 'none',
    confidence: 'none',
    note: '',
    candidates: [],
  };

  if (emailKey) {
    const byEmail = roster.people.find((p) => p.emailKey === emailKey);
    if (byEmail) {
      result.personId = byEmail.id;
      result.method = 'email';
      result.confidence = 'high';
      return result;
    }
  }

  const rawTokens = nameTokens(identity.name);
  const tokens = rawTokens.map(canonicalToken);
  const key = tokens.slice().sort().join(' ');
  const str = tokens.join(' ');

  if (tokens.length === 0) {
    result.note = 'No usable name in the Zoom report.';
    return result;
  }

  const scored = roster.people
    .map((p) => ({ person: p, ...candidateScore(tokens, str, key, p) }))
    .filter((c) => c.score !== Infinity)
    .sort((a, b) => a.score - b.score);

  result.candidates = scored.slice(0, 6).map((c) => ({
    personId: c.person.id,
    score: c.score,
    reason: c.reasons.join(', '),
  }));

  const emailNote = (person) => {
    if (emailKey && person.emailKey && emailKey !== person.emailKey) {
      return 'Joined with ' + identity.email + ' but the roster has ' + person.email + '.';
    }
    if (emailKey && !person.emailKey) {
      return 'Joined with ' + identity.email + '; roster has no email.';
    }
    if (!emailKey) {
      return 'Zoom report had no email for this person.';
    }
    return '';
  };

  const exact = roster.people.filter((p) => p.nameKey === key && p.nameKey);
  if (exact.length === 1) {
    const person = exact[0];
    const usedNickname = rawTokens.slice().sort().join(' ') !== person.rawTokens.slice().sort().join(' ');
    result.personId = person.id;
    result.method = usedNickname ? 'nickname' : 'name';
    result.confidence = usedNickname ? 'medium' : 'high';
    result.note = emailNote(person);
    return result;
  }
  if (exact.length > 1) {
    result.method = 'review';
    result.confidence = 'low';
    result.note = 'More than one roster entry has this name.';
    return result;
  }

  if (tokens.length >= 2 && scored.length > 0) {
    const best = scored[0];
    const second = scored[1];
    const minLen = 8;
    const cleanTypo = best.score <= 2 && Number.isInteger(best.score) && str.length >= minLen;
    const isolated = !second || second.score - best.score >= 2;
    if (cleanTypo && isolated) {
      result.personId = best.person.id;
      result.method = 'typo';
      result.confidence = 'medium';
      result.note = ['Name is spelled differently in Zoom.', emailNote(best.person)].filter(Boolean).join(' ');
      return result;
    }
  }

  if (scored.length > 0) {
    result.method = 'review';
    result.confidence = 'low';
    result.note = 'Possible roster matches found; needs a person to decide.';
    return result;
  }

  result.note = 'No similar name on the roster.';
  return result;
}
