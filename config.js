// Settings for this deployment. Edit these values and commit the file.
// Nothing here is secret: a client ID is a public identifier.
// The roster Sheet is not set here. Staff paste its link on the page.

export const CONFIG = {
  // OAuth client ID from Google Cloud (type: Web application).
  clientId: '872551717042-pe2gtd1731msnb6fe59q6406ortulf8j.apps.googleusercontent.com',

  // Name of the tab that holds the roster. Leave blank to use the first tab
  // that has a Name column and an Email column.
  rosterSheetName: '',

  // Default session window and policy. Staff can change these on the page.
  session: {
    start: '17:00',
    end: '18:30',
    graceMinutes: 10,
  },

  // Result tabs are named with this prefix followed by the session date.
  resultTabPrefix: 'Attendance ',
};
