# Fellowship Attendance

A small web page that turns a Zoom participant report into attendance records for the Fellowship program. Staff upload the CSV that Zoom produces, check the results on screen, and save them as a new tab in the roster Google Sheet.

Live page: https://evanboyar.github.io/NRI-attendees/

## How staff use it

You need three things: the Zoom report for the session, a Google account that can edit the roster Sheet, and a web browser. Nothing needs to be installed.

### 1. Get the report from Zoom

1. Sign in to Zoom on the web and open Reports.
2. Choose Usage, find the session meeting, and click the participant count.
3. Tick "Show unique users" if it is offered, then click Export. Zoom downloads a CSV file.

If Zoom offers "Export with meeting data", that works too. The page looks for the participant columns wherever they are.

### 2. Open the page, paste the Sheet link, and sign in

Open the live page. Paste the link to the roster Google Sheet into the box under step 1 (copy it from your browser's address bar while the Sheet is open). The page remembers the link on your computer, so you only do this once.

Then click "Sign in with Google" and pick the account that has access to that Sheet. The first time, Google asks you to allow the page to edit your spreadsheets. It only touches the Sheet you pasted.

Once you are signed in, the page reads the roster and tells you how many people it found. If you want to switch to a different Sheet later, paste the new link and click "Load roster".

### 3. Upload the Zoom report

Click "Choose File" under step 2 and pick the CSV you downloaded. The page reads the session date from the report. The start time, end time, and the number of minutes a Fellow is allowed to miss are filled in with the program defaults (5:00 to 6:30 PM, 10 minutes). Change them if this session was different.

### 4. Check the results

The page shows a count of who was present, absent, and so on, then two tables.

The first table, "Zoom entries that need a look", lists everyone who could not be matched to the roster by email. For each one the page suggests who it thinks the person is, or says it could not tell. Check the suggestion. If it is wrong, pick the right person from the dropdown, choose "Someone else on the roster" to search the whole list, or choose "Not a Fellow" for guests, staff, and devices like "iPad (2)".

The second table lists every Fellow on the roster with their attendance, minutes in the session, and any notes. You can filter it to absent Fellows only, or to rows with notes.

### 5. Save to the Sheet

Click "Save to Google Sheet". The results go into a tab named "Attendance" plus the session date, for example "Attendance 2026-08-26". If that tab already exists, the page asks before replacing it. When it finishes it gives you a link to the new tab.

The roster tab is never changed.

## What the results mean

Each Fellow gets one of these:

- **Present**: they missed 10 minutes or less of the session (or whatever allowance you set).
- **Absent**: they missed more than the allowance, or they were not in the report at all.
- **Not enrolled**: the roster says they are Withdrawn or Removed. They are listed so nobody is lost, but they are not scored.

Minutes are counted only between the session start and end. Joining early or staying late does not add time. If someone dropped and rejoined, their separate stretches are added together.

Under the Fellows, the tab lists Zoom attendees who are not on the roster (guests, staff, unnamed devices, and anything you left as "Needs review"), followed by a short summary of the session and the file that was used.

## How matching works

The page matches each Zoom entry to the roster in this order:

1. **Email.** If the Zoom email matches a roster email (ignoring capitalization), that is the person.
2. **Name.** Otherwise the name is compared after cleaning: accents, emoji, pronoun tags like "(she/her)", device tags like "(iPhone)", titles like "Prof.", and word order are all ignored, and common short names are expanded (Mike for Michael, Katie for Katherine, and so on). One clear roster match is accepted, with a note explaining it.
3. **Spelling.** A name that is one or two letters off from exactly one roster name is accepted with a note.
4. **Review.** Anything else with a plausible candidate, or with more than one candidate, is held for you to decide. Entries with nothing close, such as "Pixel 9", are listed as not on the roster.

Anything not matched by email appears in the review table so a person can confirm it before saving.

## Setting the page up (one time, for the administrator)

The page runs entirely in the browser. The only thing configured in the code is the Google sign-in client ID, which is a public identifier. The roster Sheet is chosen on the page, not in the code, so the same page works for any roster.

### The roster Sheet

1. Make a copy of the roster Google Sheet, or use the real one.
2. Share it with edit access to the staff who will run attendance.
3. Give staff the link. They paste it on the page.

The roster tab needs a header row with a column containing "Name" and a column containing "Email". A "Status" column is optional; anything other than Active (or blank) counts as not enrolled.

### The Google sign-in client

1. Go to https://console.cloud.google.com/ and create a project (any name).
2. Under "APIs and Services", enable the Google Sheets API.
3. Open "OAuth consent screen". Choose External, give the app a name and your email, and add the scopes `.../auth/spreadsheets` and `.../auth/userinfo.email`. Either add your staff as test users, or publish the app so anyone can sign in (they will see an "unverified app" warning they can click through).
4. Open "Credentials", create an OAuth client ID of type "Web application", and add these authorized JavaScript origins:
   - `https://evanboyar.github.io` (or wherever the page is hosted)
   - `http://localhost:8080` if you want to run it on your own machine
5. Copy the client ID.

### Put the client ID in config.js

Edit `config.js` and fill in `clientId`. Commit and push. GitHub Pages serves the page from the main branch.

## Running it locally

```
npm test
npm run serve
```

Then open http://localhost:8080/. There is no build step. Under Advanced on the page you can load the roster from a CSV file to try things out without Google.

## Files

- `index.html`, `styles.css`: the page.
- `config.js`: the sign-in client ID and the session defaults.
- `assets/`: the New Roots logo.
- `src/csv.js`: CSV reader and writer.
- `src/zoom.js`: reads the Zoom report and its timestamps.
- `src/names.js`: name cleaning, nickname table, and edit distance.
- `src/match.js`: builds the roster and matches Zoom entries to Fellows.
- `src/score.js`: merges join and leave times and applies the attendance rule.
- `src/output.js`: lays out the rows written to the Sheet.
- `src/auth.js`, `src/sheets.js`: Google sign-in and the Sheets API.
- `src/app.js`: ties the page together.
- `test/`: tests, run with `npm test`, including the sample data.
