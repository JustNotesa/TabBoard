import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseQuery,
  makeSearchInfo,
  evaluateSession,
  findSearchChunks,
  textMatchesAnyWord
} from "../src/common/search.js";

const session = {
  id: "s1",
  name: "Projekt München",
  windows: {
    w1: {
      1: {
        id: 1,
        title: "GitHub – tabboard/issues",
        url: "https://github.com/x/tabboard/issues/42"
      },
      2: { id: 2, title: "Stadtplan", url: "https://maps.example.org/muenchen" },
      3: { id: 3, title: "Café Zürich", url: "https://example.com/cafe" }
    },
    w2: {
      4: { id: 4, title: "Pull request #17", url: "https://github.com/x/tabboard/pull/17" },
      5: { id: 5, title: "Wetter", url: "https://wetter.example.de/" }
    }
  }
};
const info = makeSearchInfo(session);
const run = q => evaluateSession(session.name, info, parseQuery(q));
const keys = result => [...result.hitKeys].sort();

test("parseQuery splits words, phrases and exclusions", () => {
  const q = parseQuery('  foo   "Bar  Baz" -qux -"a b" - ');
  assert.deepEqual(
    q.include.map(t => t.text),
    ["foo", "Bar Baz"]
  );
  assert.deepEqual(
    q.exclude.map(t => t.text),
    ["qux", "a b"]
  );
  assert.equal(parseQuery("   ").isEmpty, true);
});

test("umlauts and accents match in every spelling", () => {
  for (const q of ["münchen", "muenchen", "munchen", "MÜNCHEN"]) {
    assert.ok(textMatchesAnyWord("Projekt München", [q]), q);
  }
  assert.ok(textMatchesAnyWord("Café Zürich", ["cafe zurich"]));
  assert.ok(textMatchesAnyWord("Straße", ["strasse"]));
});

test("URLs are searched and hits are counted per tab", () => {
  const result = run("github");
  assert.equal(result.hitCount, 2);
  assert.deepEqual(keys(result), ["w1:1", "w2:4"]);
});

test("words may come from the session name and from different tabs", () => {
  const nameOnly = run("projekt");
  assert.equal(nameOnly.hitKeys, null);

  const mixed = run("münchen github");
  assert.deepEqual(keys(mixed), ["w1:1", "w2:4"]);

  const acrossTabs = run("github wetter");
  assert.deepEqual(keys(acrossTabs), ["w1:1", "w2:4", "w2:5"]);

  assert.equal(run("github nirgendwo"), null);
});

test("exact phrases and exclusions", () => {
  assert.deepEqual(keys(run('"pull request"')), ["w2:4"]);
  assert.equal(run('"request pull"'), null);
  assert.deepEqual(keys(run("github -pull")), ["w1:1"]);
  assert.equal(run("-münchen"), null);
  assert.deepEqual(keys(run("-github")), ["w1:2", "w1:3", "w2:5"]);
});

test("highlight chunks map back to the original text", () => {
  const text = "Projekt München";
  const chunks = findSearchChunks({ searchWords: ["muenchen"], textToHighlight: text });
  assert.ok(chunks.some(c => text.slice(c.start, c.end) === "München"));
  const plain = findSearchChunks({ searchWords: ["munchen"], textToHighlight: text });
  assert.ok(plain.some(c => text.slice(c.start, c.end) === "München"));
  assert.deepEqual(findSearchChunks({ searchWords: [], textToHighlight: text }), []);
});
