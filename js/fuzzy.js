// Normalize Russian text: lowercase, strip punctuation
export function normalize(text) {
  return text
    .toLowerCase()
    .replace(/[.,!?;:«»"'–—\-]/g, '')
    .replace(/ё/g, 'е') // treat ё and е as same
    .trim();
}

// Simple Levenshtein distance
function levenshtein(a, b) {
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  );
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] = a[i-1] === b[j-1]
        ? dp[i-1][j-1]
        : 1 + Math.min(dp[i-1][j], dp[i][j-1], dp[i-1][j-1]);
  return dp[m][n];
}

// Returns true if spoken word is close enough to expected word
export function wordMatches(spoken, expected) {
  const s = normalize(spoken);
  const e = normalize(expected);
  if (!s || !e) return false;
  if (s === e) return true;
  // Allow 1 edit for short words, 2 for longer
  const maxDist = e.length <= 4 ? 1 : 2;
  return levenshtein(s, e) <= maxDist;
}

// Aligns spoken words against expected words, returns array of match booleans
export function alignWords(spokenText, expectedWords) {
  const spokenWords = normalize(spokenText).split(/\s+/).filter(Boolean);
  const matched = new Array(expectedWords.length).fill(false);
  let si = 0;
  for (let ei = 0; ei < expectedWords.length && si < spokenWords.length; ei++) {
    if (wordMatches(spokenWords[si], expectedWords[ei])) {
      matched[ei] = true;
      si++;
    }
  }
  return matched;
}

// Returns fraction of expected words that were spoken
export function scoreMatch(spokenText, expectedLine) {
  const expected = normalize(expectedLine).split(/\s+/).filter(Boolean);
  if (!expected.length) return 1;
  const matched = alignWords(spokenText, expected);
  return matched.filter(Boolean).length / expected.length;
}
