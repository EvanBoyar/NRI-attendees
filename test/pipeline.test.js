import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseCsv } from '../src/csv.js';
import { buildRoster } from '../src/match.js';
import { parseZoomReport, detectSessionDate } from '../src/zoom.js';
import { analyze, buildReport } from '../src/score.js';
import { reportRows } from '../src/output.js';

const rosterText = readFileSync(new URL('./fixtures/roster_sample.csv', import.meta.url), 'utf8');
const zoomText = readFileSync(new URL('./fixtures/zoom_attendance_sample.csv', import.meta.url), 'utf8');

const roster = buildRoster(parseCsv(rosterText));
const zoom = parseZoomReport(zoomText);
const session = { date: detectSessionDate(zoom.rows), start: '17:00', end: '18:30' };
const analysis = analyze({ roster, zoomRows: zoom.rows, session });
const report = buildReport(analysis, {}, 10);

const fellow = (name) => report.fellows.find((f) => f.person.name === name);
const other = (name) => report.others.find((o) => o.identity.name === name);
const personName = (id) => roster.people.find((p) => p.id === id).name;

test('detects the session date and ignores rows from other dates', () => {
  assert.equal(session.date, '2026-08-26');
  assert.equal(report.summary.offDateRows, 2);
});

test('roster duplicates are merged and flagged', () => {
  assert.equal(roster.people.filter((p) => p.name === 'Esther Navarro').length, 1);
  assert.match(fellow('Esther Navarro').person.status, /Conflict/);
  assert.equal(roster.people.filter((p) => p.name === 'Maria Vasquez').length, 2);
});

test('rejoins are added together', () => {
  const adam = fellow('Adam Hamdan');
  assert.equal(adam.attendance, 'Present');
  assert.ok(adam.attendedMinutes > 85 && adam.attendedMinutes < 87, String(adam.attendedMinutes));
  const uma = fellow('Uma Elmore');
  assert.equal(uma.attendance, 'Absent');
  assert.ok(uma.attendedMinutes > 63 && uma.attendedMinutes < 64);
});

test('grace rule: more than ten minutes missed is absent', () => {
  assert.equal(fellow('Jenny Rutledge').attendance, 'Present');
  assert.equal(fellow('Erin Bonilla').attendance, 'Absent');
  assert.equal(fellow('Felix Ibarra').attendance, 'Absent');
  assert.equal(fellow('Julia Crespo').attendance, 'Present');
});

test('missing Fellows are absent, non-enrolled are not scored', () => {
  assert.equal(fellow('Alejandro Aoki').attendance, 'Absent');
  assert.equal(fellow('Alejandro Aoki').matchMethod, 'Not found in Zoom report');
  assert.equal(fellow('Kai Endo').attendance, 'Not enrolled');
});

test('email matches survive typos and case differences', () => {
  assert.equal(fellow('Paulo Gannon').matchMethod, 'Email');
  assert.equal(fellow('Rebecca Dalton').matchMethod, 'Email');
  assert.equal(fellow('Leilani Akhtar').inReport, true);
  assert.equal(fellow('Camila Asante').matchMethod, 'Email');
});

test('name matches handle order, accents, short forms, and other emails', () => {
  assert.equal(fellow('Thanh Nguyen').matchMethod, 'Name');
  assert.equal(fellow('José Ramírez').matchMethod, 'Name');
  assert.equal(fellow('Michael Sandoval').matchMethod, 'Name (short form)');
  assert.equal(fellow('Lena Park').matchMethod, 'Name');
  // Anika joined first from a Gmail account, then from the roster address.
  assert.equal(fellow('Anika Petrov').matchMethod, 'Name; Email');
  assert.equal(fellow('Anika Petrov').attendance, 'Present');
  assert.match(fellow('Anika Petrov').notes.join(' '), /anika.p.music@gmail.com/);
  assert.equal(fellow('Deepa Lozano').matchMethod, 'Name');
});

test('ambiguous names are held for review with candidates', () => {
  const maria = other('Maria Vasquez');
  assert.equal(maria.status, 'Needs review');
  assert.equal(maria.identity.match.candidates.length, 2);
  const rebeca = other('Rebeca Kowalsky');
  assert.equal(rebeca.status, 'Needs review');
  const names = rebeca.identity.match.candidates.map((c) => personName(c.personId));
  assert.ok(names.includes('Rebeka Kowalsky') && names.includes('Rebecca Kowalski'), names.join(','));
});

test('guests, devices, and instructions in names are not Fellows', () => {
  assert.equal(other('Dana Whitfield (New Roots)').status, 'Not on roster');
  assert.equal(other('Pixel 9').status, 'Not on roster');
  const bot = report.others.find((o) => o.identity.name.startsWith('Zoom Assistant'));
  assert.equal(bot.status, 'Not on roster');
  assert.equal(other('Prof. Leila Nassar (Guest Speaker)').status, 'Not on roster');
});

test('staff assignments override the matcher', () => {
  const maria = other('Maria Vasquez');
  // One Maria Vasquez already matched by email; assign the no-email row to the other one.
  const target = maria.identity.match.candidates
    .map((c) => c.personId)
    .find((id) => !report.fellows.find((f) => f.person.id === id).inReport);
  const r2 = buildReport(analysis, { [maria.identity.key]: target }, 10);
  const assigned = r2.fellows.find((f) => f.person.id === target);
  assert.equal(assigned.matchMethod, 'Assigned by staff');
  assert.equal(assigned.attendance, 'Absent');
  assert.ok(assigned.attendedMinutes > 44 && assigned.attendedMinutes < 45);
  assert.equal(r2.others.find((o) => o.identity.name === 'Maria Vasquez'), undefined);
  const r3 = buildReport(analysis, { [maria.identity.key]: 'guest' }, 10);
  assert.equal(r3.others.find((o) => o.identity.name === 'Maria Vasquez').status, 'Not on roster');
});

test('output rows have one line per roster person', () => {
  const rows = reportRows(report, { fileName: 'x.csv' });
  assert.equal(rows[0][0], 'Fellow Name');
  assert.equal(rows.slice(1, 1 + report.fellows.length).length, roster.people.length);
});
