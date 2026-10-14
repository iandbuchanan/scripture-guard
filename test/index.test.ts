import { test } from "node:test";
import assert from "node:assert/strict";
import {
  citedReferences,
  generateWithoutQuoting,
  hasLongQuotedSpan,
  quotesPassage,
  ScriptureQuoteError,
  strikePassage,
  words,
} from "../src/index.ts";

// John 1:1-3, King James Version (public domain), with verse markers as one API might send them.
const PASSAGE =
  "<sup>1</sup>In the beginning was the Word, and the Word was with God, and the Word was God. " +
  "[2]The same was in the beginning with God. 3All things were made by him; and without him was not any thing made that was made.";

test("words() drops markup, entities, digits and apostrophes, and folds accents", () => {
  assert.deepEqual(words("<b>14</b>And God’s Word &amp; more"), ["and", "gods", "word", "more"]);
  assert.deepEqual(words("café"), ["cafe"]);
});

test("quotesPassage() flags six consecutive words, whatever the verse-number format", () => {
  assert.equal(quotesPassage("He said the Word was with God, and the Word was God.", PASSAGE), true);
  assert.equal(quotesPassage("John opens with the Word, who was with God.", PASSAGE), false);
  assert.equal(quotesPassage("all things were made by him", PASSAGE), true);
});

test("quotesPassage() lets common short phrases through", () => {
  assert.equal(quotesPassage("In the beginning, John says, there was already the Word.", PASSAGE), false);
});

test("quotesPassage() honours a custom run length", () => {
  assert.equal(quotesPassage("the Word was with God", PASSAGE, 5), true);
  assert.equal(quotesPassage("the Word was with God", PASSAGE), false);
});

test("strikePassage() removes the passage read aloud and keeps the rest", () => {
  const transcript =
    "Okay, let's read. In the beginning was the Word, and the Word was with God, and the Word was God. What do you think that means?";
  const struck = strikePassage(transcript, PASSAGE);
  assert.equal(struck, "Okay, let's read. [passage] What do you think that means?");
  assert.equal(quotesPassage(struck, PASSAGE), false);
});

test("strikePassage() swallows a misheard word between two struck stretches", () => {
  const transcript = "In the beginning was the Word, and the Ward was with God, and the Word was God. Amen.";
  assert.equal(strikePassage(transcript, PASSAGE, { replacement: "[…]" }), "[…] Amen.");
});

test("citedReferences() finds verse citations in prose and ignores bare pointers", () => {
  assert.deepEqual(citedReferences("As John 3:16 says, and 1 John 2:1 too."), ["JHN.3.16", "1JN.2.1"]);
  assert.deepEqual(citedReferences("See Romans 8:28–30 and Song of Solomon 2:1."), ["ROM.8.28-30", "SNG.2.1"]);
  assert.deepEqual(citedReferences("Read Psalms 23 tonight."), []);
  assert.deepEqual(citedReferences("Psalm 23:1"), ["PSA.23.1"]);
});

test("citedReferences() resolves against a caller's own book list", () => {
  const books = [{ id: "TOB", title: "Tobit" }];
  assert.deepEqual(citedReferences("Tobit 4:15 and John 3:16", books), ["TOB.4.15"]);
});

test("hasLongQuotedSpan() catches long quotes and not apostrophes", () => {
  assert.equal(hasLongQuotedSpan('He wrote, "one two three four five six seven eight nine ten."'), true);
  assert.equal(hasLongQuotedSpan('He wrote, "a short quote here."'), false);
  assert.equal(hasLongQuotedSpan("‘one two three four five six seven eight nine ten’"), true);
  assert.equal(
    hasLongQuotedSpan("the disciples' hearts were glad and they kept to the apostles' teaching every day together"),
    false,
  );
  assert.equal(hasLongQuotedSpan("'God's people don't stop praying when the answer is slow to come'"), true);
});

test("generateWithoutQuoting() retries with the note, then returns clean output", async () => {
  const notes: string[] = [];
  const outputs = ["the Word was with God, and the Word was God", "John calls Jesus the Word (v. 1)."];
  const result = await generateWithoutQuoting({
    generate: async (note) => (notes.push(note), outputs[notes.length - 1]),
    texts: (r) => [r],
    passageText: PASSAGE,
  });
  assert.equal(result, outputs[1]);
  assert.equal(notes[0], "");
  assert.notEqual(notes[1], "");
});

test("generateWithoutQuoting() throws rather than return a quote", async () => {
  await assert.rejects(
    generateWithoutQuoting({
      generate: async () => ({ text: "all things were made by him; and without him" }),
      texts: (r) => [r.text],
      passageText: PASSAGE,
    }),
    ScriptureQuoteError,
  );
});
