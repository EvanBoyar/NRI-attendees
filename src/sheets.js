// Google Sheets access from the browser using a user access token.

const API = 'https://sheets.googleapis.com/v4/spreadsheets/';

export function spreadsheetIdFromInput(text) {
  const s = String(text || '').trim();
  const m = /\/d\/([a-zA-Z0-9-_]+)/.exec(s);
  if (m) return m[1];
  if (/^[a-zA-Z0-9-_]{20,}$/.test(s)) return s;
  return '';
}

export class SheetsError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function call(token, url, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: {
      Authorization: 'Bearer ' + token,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  if (res.ok) {
    return res.status === 204 ? null : res.json();
  }
  let detail = '';
  try {
    const body = await res.json();
    detail = body.error && body.error.message ? body.error.message : '';
  } catch (e) {
    detail = '';
  }
  let message;
  if (res.status === 401) {
    message = 'Your Google sign-in has expired. Sign in again and retry.';
  } else if (res.status === 403) {
    message = 'This Google account is not allowed to edit the Sheet. Ask whoever owns the Sheet to share it with you.';
  } else if (res.status === 404) {
    message = 'The Sheet could not be found. Check the spreadsheet ID in the settings.';
  } else {
    message = 'Google Sheets returned an error (' + res.status + ').';
  }
  if (detail) message += ' Details: ' + detail;
  throw new SheetsError(res.status, message);
}

export async function listSheets(token, spreadsheetId) {
  const data = await call(token, API + spreadsheetId + '?fields=properties.title,sheets.properties');
  return {
    title: data.properties.title,
    sheets: data.sheets.map((s) => ({
      title: s.properties.title,
      sheetId: s.properties.sheetId,
      index: s.properties.index,
    })),
  };
}

export async function readValues(token, spreadsheetId, range) {
  const data = await call(
    token,
    API + spreadsheetId + '/values/' + encodeURIComponent(range) + '?valueRenderOption=FORMATTED_VALUE'
  );
  return data.values || [];
}

// Finds the roster tab: the named one if given, else the first tab whose top
// rows contain a Name column and an Email column.
export async function loadRoster(token, spreadsheetId, preferredName) {
  const info = await listSheets(token, spreadsheetId);
  const ordered = info.sheets.slice().sort((a, b) => a.index - b.index);
  const candidates = preferredName
    ? ordered.filter((s) => s.title === preferredName)
    : ordered;
  for (const sheet of candidates) {
    const rows = await readValues(token, spreadsheetId, "'" + sheet.title.replace(/'/g, "''") + "'");
    const top = rows.slice(0, 30);
    const hasHeader = top.some((r) => {
      const cells = r.map((c) => String(c).toLowerCase());
      return cells.some((c) => /name/.test(c)) && cells.some((c) => /e-?mail/.test(c));
    });
    if (hasHeader) {
      return { spreadsheetTitle: info.title, sheetTitle: sheet.title, rows };
    }
  }
  throw new SheetsError(
    0,
    'No tab in the Sheet looks like a roster. The roster needs a header row with a Name column and an Email column.'
  );
}

function columnLetter(index) {
  let n = index + 1;
  let s = '';
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

// Writes rows to a tab named title, replacing the tab if it already exists.
// layout: { boldRows: [rowIndexes], statusColumn, statusRowCount, columnCount }
export async function writeReport(token, spreadsheetId, title, rows, layout) {
  const info = await listSheets(token, spreadsheetId);
  const existing = info.sheets.find((s) => s.title === title);
  const requests = [];
  if (existing) {
    requests.push({ deleteSheet: { sheetId: existing.sheetId } });
  }
  requests.push({
    addSheet: {
      properties: {
        title,
        gridProperties: { frozenRowCount: 1, rowCount: Math.max(rows.length + 5, 50), columnCount: layout.columnCount + 2 },
      },
    },
  });
  const created = await call(token, API + spreadsheetId + ':batchUpdate', {
    method: 'POST',
    body: JSON.stringify({ requests }),
  });
  const addReply = created.replies.find((r) => r.addSheet);
  const sheetId = addReply.addSheet.properties.sheetId;

  const range = "'" + title.replace(/'/g, "''") + "'!A1";
  await call(
    token,
    API + spreadsheetId + '/values/' + encodeURIComponent(range) + '?valueInputOption=RAW',
    {
      method: 'PUT',
      body: JSON.stringify({ range, majorDimension: 'ROWS', values: rows }),
    }
  );

  const format = [];
  for (const r of layout.boldRows) {
    format.push({
      repeatCell: {
        range: { sheetId, startRowIndex: r, endRowIndex: r + 1 },
        cell: { userEnteredFormat: { textFormat: { bold: true } } },
        fields: 'userEnteredFormat.textFormat.bold',
      },
    });
  }
  const statusRange = {
    sheetId,
    startRowIndex: 1,
    endRowIndex: 1 + layout.statusRowCount,
    startColumnIndex: layout.statusColumn,
    endColumnIndex: layout.statusColumn + 1,
  };
  const colors = [
    ['Present', { red: 0.85, green: 0.94, blue: 0.83 }],
    ['Absent', { red: 0.96, green: 0.8, blue: 0.8 }],
    ['Not enrolled', { red: 0.9, green: 0.9, blue: 0.9 }],
  ];
  colors.forEach(([text, color], i) => {
    format.push({
      addConditionalFormatRule: {
        rule: {
          ranges: [statusRange],
          booleanRule: {
            condition: { type: 'TEXT_EQ', values: [{ userEnteredValue: text }] },
            format: { backgroundColor: color },
          },
        },
        index: i,
      },
    });
  });
  format.push({
    autoResizeDimensions: {
      dimensions: { sheetId, dimension: 'COLUMNS', startIndex: 0, endIndex: layout.columnCount },
    },
  });
  // Notes can be long; cap that column so the tab stays readable.
  format.push({
    updateDimensionProperties: {
      range: { sheetId, dimension: 'COLUMNS', startIndex: layout.columnCount - 1, endIndex: layout.columnCount },
      properties: { pixelSize: 420 },
      fields: 'pixelSize',
    },
  });
  await call(token, API + spreadsheetId + ':batchUpdate', {
    method: 'POST',
    body: JSON.stringify({ requests: format }),
  });

  return {
    sheetId,
    url: 'https://docs.google.com/spreadsheets/d/' + spreadsheetId + '/edit#gid=' + sheetId,
    lastColumn: columnLetter(layout.columnCount - 1),
  };
}

export async function fetchUserEmail(token) {
  try {
    const res = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: 'Bearer ' + token },
    });
    if (!res.ok) return '';
    const data = await res.json();
    return data.email || '';
  } catch (e) {
    return '';
  }
}
