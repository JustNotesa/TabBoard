// Search helpers shared by the background script and the popup.
//
// Text is compared in two "folded" forms so that German spellings match each other:
//   a: lowercase, umlauts transliterated (ä→ae, ö→oe, ü→ue, ß→ss), other accents removed
//   b: lowercase, all accents removed (ä→a, ü→u, é→e)
// A term matches when it is found in the text in either form, so "muenchen", "münchen"
// and "munchen" all find "München".

const TRANSLIT = { ä: "ae", ö: "oe", ü: "ue", ß: "ss" };
const COMBINING_MARKS = /[̀-ͯ]/g;

const stripMarks = text => text.normalize("NFD").replace(COMBINING_MARKS, "");

const foldA = text =>
  stripMarks(text.toLowerCase().replace(/[äöüß]/g, ch => TRANSLIT[ch])).replace(/\s+/g, " ");
const foldB = text => stripMarks(text.toLowerCase().replace(/ß/g, "ss")).replace(/\s+/g, " ");

export const foldText = (text = "") => ({ a: foldA(text), b: foldB(text) });

const makeTerm = text => {
  const trimmed = text.replace(/\s+/g, " ").trim();
  return { text: trimmed, a: foldA(trimmed), b: foldB(trimmed) };
};

// Parses a query into include and exclude terms.
//   foo bar      → both words must appear
//   "foo bar"    → this exact sequence must appear
//   -foo         → must not appear (also -"foo bar")
export const parseQuery = (query = "") => {
  const include = [];
  const exclude = [];
  const tokenRegex = /(-?)"([^"]*)"?|(\S+)/g;
  let match;
  while ((match = tokenRegex.exec(query)) !== null) {
    let isExclude;
    let text;
    if (match[3] !== undefined) {
      isExclude = match[3].startsWith("-") && match[3].length > 1;
      text = isExclude ? match[3].slice(1) : match[3];
    } else {
      isExclude = match[1] === "-";
      text = match[2];
    }
    const term = makeTerm(text);
    if (!term.a && !term.b) continue;
    if (text === "-") continue;
    (isExclude ? exclude : include).push(term);
  }
  return { include, exclude, isEmpty: include.length === 0 && exclude.length === 0 };
};

export const termMatches = (term, folded) => folded.a.includes(term.a) || folded.b.includes(term.b);

// Search index of one session: the folded text of every tab (title and URL).
export const makeSearchInfo = session => {
  const tabs = [];
  for (const [windowId, windowTabs] of Object.entries(session.windows || {})) {
    for (const [tabKey, tab] of Object.entries(windowTabs || {})) {
      const tabId = tab?.id ?? tabKey;
      tabs.push({
        key: `${windowId}:${tabId}`,
        ...foldText(`${tab?.title || ""}\n${tab?.url || ""}`)
      });
    }
  }
  return { id: session.id, tabs };
};

// Evaluates a parsed query against one session.
// Returns null when the session does not match, otherwise
//   hitKeys:  Set of "windowId:tabId" that match, or null when every tab counts as a hit
//   hitCount: number of matching tabs (only meaningful when hitKeys is not null)
export const evaluateSession = (sessionName, searchInfo, query) => {
  if (query.isEmpty) return { hitKeys: null, hitCount: 0 };
  const name = foldText(sessionName || "");
  if (query.exclude.some(term => termMatches(term, name))) return null;

  const tabs = (searchInfo?.tabs || []).filter(
    tab => !query.exclude.some(term => termMatches(term, tab))
  );
  const remaining = query.include.filter(term => !termMatches(term, name));

  for (const term of remaining) {
    if (!tabs.some(tab => termMatches(term, tab))) return null;
  }

  if (remaining.length === 0 && query.exclude.length === 0) return { hitKeys: null, hitCount: 0 };

  const hitTabs =
    remaining.length > 0
      ? tabs.filter(tab => remaining.some(term => termMatches(term, tab)))
      : tabs;
  if (hitTabs.length === 0) return null;
  return { hitKeys: new Set(hitTabs.map(tab => tab.key)), hitCount: hitTabs.length };
};

// Folds text character by character and remembers which original character every folded
// character came from, so matches can be mapped back for highlighting.
const foldWithMap = (text, fold) => {
  let folded = "";
  const map = [];
  for (let i = 0; i < text.length; i++) {
    const part = fold(text[i]);
    folded += part;
    for (let k = 0; k < part.length; k++) map.push(i);
  }
  return { folded, map };
};
const foldCharA = ch => {
  const lower = ch.toLowerCase();
  return TRANSLIT[lower] || stripMarks(lower);
};
const foldCharB = ch => {
  const lower = ch.toLowerCase();
  return lower === "ß" ? "ss" : stripMarks(lower);
};

// findChunks implementation for react-highlight-words that understands the folding above.
export const findSearchChunks = ({ searchWords, textToHighlight }) => {
  const text = textToHighlight || "";
  const terms = (searchWords || []).map(makeTerm).filter(term => term.a || term.b);
  if (terms.length === 0 || !text) return [];

  const chunks = [];
  const variants = [
    { ...foldWithMap(text, foldCharA), key: "a" },
    { ...foldWithMap(text, foldCharB), key: "b" }
  ];
  for (const { folded, map, key } of variants) {
    for (const term of terms) {
      const needle = term[key];
      if (!needle) continue;
      let index = folded.indexOf(needle);
      while (index !== -1) {
        const start = map[index];
        const end = map[index + needle.length - 1] + 1;
        chunks.push({ start, end, highlight: false });
        index = folded.indexOf(needle, index + needle.length);
      }
    }
  }
  return chunks;
};

export const textMatchesAnyWord = (text, searchWords) => {
  if (!text || !searchWords || searchWords.length === 0) return false;
  const folded = foldText(text);
  return searchWords.map(makeTerm).some(term => (term.a || term.b) && termMatches(term, folded));
};
