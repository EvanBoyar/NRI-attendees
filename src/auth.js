// Google sign-in using Google Identity Services (token model).

const SCOPES = [
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/userinfo.email',
].join(' ');

let tokenClient = null;
let token = null;
let expiresAt = 0;

function waitForGoogle() {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const tick = () => {
      if (window.google && window.google.accounts && window.google.accounts.oauth2) {
        resolve();
      } else if (Date.now() - started > 10000) {
        reject(new Error('The Google sign-in library did not load. Check your internet connection and reload the page.'));
      } else {
        setTimeout(tick, 100);
      }
    };
    tick();
  });
}

export async function initAuth(clientId) {
  await waitForGoogle();
  tokenClient = window.google.accounts.oauth2.initTokenClient({
    client_id: clientId,
    scope: SCOPES,
    callback: () => {},
  });
}

export function signIn() {
  return new Promise((resolve, reject) => {
    if (!tokenClient) {
      reject(new Error('Sign-in is not set up. The page needs a Google client ID in config.js.'));
      return;
    }
    tokenClient.callback = (resp) => {
      if (resp.error) {
        reject(new Error('Google sign-in failed: ' + resp.error));
        return;
      }
      token = resp.access_token;
      expiresAt = Date.now() + (resp.expires_in || 3600) * 1000 - 30000;
      resolve(token);
    };
    tokenClient.error_callback = (err) => {
      const type = err && err.type ? err.type : 'unknown';
      if (type === 'popup_closed') {
        reject(new Error('The sign-in window was closed before finishing.'));
      } else if (type === 'popup_failed_to_open') {
        reject(new Error('The browser blocked the sign-in window. Allow pop-ups for this site and try again.'));
      } else {
        reject(new Error('Google sign-in failed (' + type + ').'));
      }
    };
    tokenClient.requestAccessToken({ prompt: '' });
  });
}

export function currentToken() {
  if (token && Date.now() < expiresAt) return token;
  return null;
}

export function signOut() {
  if (token && window.google) {
    window.google.accounts.oauth2.revoke(token, () => {});
  }
  token = null;
  expiresAt = 0;
}
