// Name normalization and string distance helpers used by the matcher.

const HONORIFICS = new Set([
  'prof', 'professor', 'dr', 'doctor', 'mr', 'mrs', 'ms', 'mx', 'miss', 'sir', 'rev',
]);

// Common short forms mapped to a canonical first name. Only the forms that are
// unambiguous enough to act on automatically belong here.
const NICKNAMES = {
  mike: 'michael', mikey: 'michael', mick: 'michael',
  katie: 'katherine', kate: 'katherine', kathy: 'katherine', katy: 'katherine', kat: 'katherine',
  becky: 'rebecca', becca: 'rebecca', rebeca: 'rebecca',
  liz: 'elizabeth', beth: 'elizabeth', lizzie: 'elizabeth', eliza: 'elizabeth',
  jim: 'james', jimmy: 'james',
  jon: 'jonathan', johnny: 'john',
  ed: 'edward', eddie: 'edward',
  chris: 'christopher',
  patty: 'patricia', trish: 'patricia',
  rick: 'richard', ricky: 'richard',
  nate: 'nathan',
  bill: 'william', will: 'william', billy: 'william', willy: 'william',
  bob: 'robert', rob: 'robert', bobby: 'robert', robbie: 'robert',
  dan: 'daniel', danny: 'daniel',
  dave: 'david', davey: 'david',
  tom: 'thomas', tommy: 'thomas',
  tony: 'anthony',
  steve: 'steven', stephen: 'steven',
  joe: 'joseph', joey: 'joseph',
  matt: 'matthew',
  nick: 'nicholas',
  ben: 'benjamin', benny: 'benjamin',
  sam: 'samuel', sammy: 'samuel',
  alex: 'alexander',
  andy: 'andrew', drew: 'andrew',
  greg: 'gregory',
  jen: 'jennifer', jenny: 'jennifer',
  jess: 'jessica', jesica: 'jessica',
  sue: 'susan', susie: 'susan',
  maggie: 'margaret', meg: 'margaret', peggy: 'margaret',
  abby: 'abigail',
  gabby: 'gabriela', gabi: 'gabriela', gabriella: 'gabriela',
  tess: 'tessa',
  max: 'maximilian',
  ray: 'raymond',
  ron: 'ronald', ronnie: 'ronald',
  larry: 'lawrence',
  lou: 'louis',
  vicky: 'victoria', vicki: 'victoria',
  josh: 'joshua',
  zach: 'zachary', zack: 'zachary',
  manny: 'manuel',
  pepe: 'jose',
  paco: 'francisco',
};

export function stripDiacritics(s) {
  return s.normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
}

// Removes pronoun tags like "she/her" wherever they appear.
function stripPronouns(s) {
  return s.replace(
    /\b(she|he|they|ze|xe|ey|any|all)\s*\/\s*(her|him|them|hir|xem|zir|em|any|all)(\s*\/\s*\w+)?\b/gi,
    ' '
  );
}

// Returns the list of lowercase ascii name tokens with noise removed.
export function nameTokens(raw) {
  let s = String(raw || '');
  s = s.replace(/\([^)]*\)/g, ' ').replace(/\[[^\]]*\]/g, ' ').replace(/\{[^}]*\}/g, ' ');
  s = stripPronouns(s);
  s = stripDiacritics(s).toLowerCase();
  s = s.replace(/['’.]/g, '');
  s = s.replace(/[^a-z\s-]/g, ' ').replace(/-/g, ' ');
  return s
    .split(/\s+/)
    .filter(Boolean)
    .filter((t) => !HONORIFICS.has(t));
}

export function canonicalToken(t) {
  return NICKNAMES[t] || t;
}

// A display-friendly cleaned name: original casing, but with device tags,
// pronouns, and emoji removed.
export function cleanDisplayName(raw) {
  let s = String(raw || '');
  s = s.replace(/\([^)]*\)/g, ' ').replace(/\[[^\]]*\]/g, ' ');
  s = stripPronouns(s);
  s = s.replace(/[^\p{L}\p{M}\p{N}\s'’.\-]/gu, ' ');
  return s.replace(/\s+/g, ' ').trim();
}

export function nameKey(raw) {
  return nameTokens(raw).map(canonicalToken).sort().join(' ');
}

export function nameString(raw) {
  return nameTokens(raw).map(canonicalToken).join(' ');
}

// Optimal string alignment distance (Levenshtein plus adjacent transpositions).
export function editDistance(a, b) {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const d = [];
  for (let i = 0; i <= m; i++) {
    d[i] = [i];
  }
  for (let j = 1; j <= n; j++) {
    d[0][j] = j;
  }
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      }
    }
  }
  return d[m][n];
}

export function normalizeEmail(raw) {
  return String(raw || '').trim().toLowerCase();
}
