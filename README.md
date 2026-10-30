# scripture-guard

**Keep a language model from writing Scripture.**

Language models quote the Bible from memory, and memory is not a Bible. They blend translations,
drop words, and invent verses that sound right. If your application shows Scripture, the safe
rule is simple: **every word of Scripture a reader sees comes from a Bible text you retrieved,
never from the model.** The model may choose a reference and talk *about* a passage. It may not
reproduce it.

Prompts can ask for that. This library checks it. It is small, has no dependencies, and works
with any model and any Bible source.

## Status

**Prototype.** scripture-guard was built for a hackathon as a minimal viable product: the
smallest guard that shows the pattern working end to end. The API may change, and how well it
works on real model output hasn't been measured yet (see [Testing](#testing)).

## Install

```bash
npm install github:iandbuchanan/scripture-guard
```

Requires Node 22.18 or later (or any bundler that handles ES modules).

## The pattern

1. **Reference, then retrieve.** Have the model return a reference only (for example a USFM
   reference such as `JHN.3.16`), validate it, and fetch the text from your Bible source. Never
   fall back to model text when retrieval fails.
2. **Check what comes out.** Run every model-written string that reaches a reader through
   `quotesPassage()` against the passage that was in scope. Regenerate once, then fail.
3. **Strike what goes in.** Text that carries the passage into a prompt (a transcript of someone
   reading aloud, a user's pasted notes) goes through `strikePassage()` first, so the model has
   nothing to echo.
4. **Check output that had no passage.** When the model answers without a retrieved passage,
   retrieve whatever verses it cites (`citedReferences()`) and check against those, and refuse
   long quoted spans you can't verify (`hasLongQuotedSpan()`).
5. **Show attribution** wherever retrieved text appears. Most translations require it.

## API

```ts
import {
  quotesPassage,
  strikePassage,
  citedReferences,
  hasLongQuotedSpan,
  generateWithoutQuoting,
} from "scripture-guard";
```

### `quotesPassage(output, passageText, run = 6): boolean`

True when `output` repeats `run` or more consecutive words of `passageText`. Six words is well
past common phrases such as "the Son of God". Comparison ignores case, punctuation, markup,
HTML entities, accents and digits, so verse numbers in any format (`<sup>14</sup>`, `[14]`,
`14And`) never hide a match.

### `strikePassage(text, passageText, { run, replacement, gap }?): string`

Returns `text` with every stretch that repeats the passage replaced by `replacement` (default
`"[passage]"`). Up to `gap` stray words (default 3) between two struck stretches go with them, so
a misheard word in the middle of a reading doesn't leave fragments behind.

### `citedReferences(output, books = PROTESTANT_CANON): string[]`

Verse-level citations in prose ("As John 3:16 says", "Romans 8:28–30") as USFM references
(`JHN.3.16`, `ROM.8.28-30`). Bare pointers such as "read Psalms 23" are ignored: a pointer isn't a
quote. Pass your Bible source's own book list (`{ id, title }[]`) to match its titles.

### `hasLongQuotedSpan(output, minWords = 10): boolean`

True when `output` has 10 or more words inside quotation marks. Single quotes that serve as
apostrophes ("God's", "the apostles' teaching") are handled.

### `generateWithoutQuoting({ generate, texts, passageText, attempts?, run?, rewriteNote? })`

Calls `generate(note)`, checks every string `texts(result)` returns, and regenerates with a
rewrite note when any of them quotes the passage. Throws `ScriptureQuoteError` after `attempts`
tries (default 2) rather than return a quote.

```ts
const result = await generateWithoutQuoting({
  generate: (note) => model.json(discussionPrompt({ passageText, note })),
  texts: (r) => r.questions.map((q) => q.text), // every field a reader sees
  passageText,
});
```

**`texts` must cover every string field that reaches a reader.** A field left out is not
checked, and that is the likeliest way a guard like this quietly stops working.

## Testing

```bash
npm test
```

[`test/index.test.ts`](test/index.test.ts) holds 11 unit tests, run with Node's built-in test
runner. They check that each function does what this README says:

- `words()` strips markup, entities, digits and apostrophes, and folds accents.
- `quotesPassage()` catches a six-word run whatever the verse-number format (`<sup>1</sup>`,
  `[2]`, `3All`), lets short common phrases through, and honours a custom run length.
- `strikePassage()` removes a passage read aloud from a transcript, including one with a misheard
  word mid-reading.
- `citedReferences()` resolves verse citations in prose (with aliases such as Psalm/Psalms),
  ignores bare pointers such as "Read Psalms 23", and accepts a caller's own book list.
- `hasLongQuotedSpan()` catches long double- and single-quoted spans without mistaking
  apostrophes for quotation marks.
- `generateWithoutQuoting()` retries with the rewrite note, and throws rather than return a quote.

### What the tests don't cover

The tests show the code does what it says. They don't yet show how well it keeps a model from
writing Scripture:

- **No real model output.** Every input is hand-written. Nothing measures how often models quote,
  or how much of that the guard catches.
- **No catch rate or false-positive rate.** The six-word default is a judgment call, not a
  measured threshold.
- **One passage, one translation.** Every test uses John 1:1–3 (KJV). Long or poetic passages, a
  model quoting a different translation from the one you retrieved, and near-verbatim paraphrase
  are untested.
- **No CI.** Tests run on `npm test` and before publishing, not on every push.

The next step is an effectiveness eval: a labeled set of quoting and non-quoting model outputs
across several passages and translations, scored for each function.

## Limits

- It is lexical. It catches repeated wording, not a loose paraphrase. Ask for no paraphrase in
  the prompt as well.
- It checks against the passage you give it. Output with no passage in scope needs
  `citedReferences()` and `hasLongQuotedSpan()`, and they cannot catch an uncited, unquoted verse.
- `citedReferences()` matches English book titles and Arabic numerals.

## License

MIT. See [LICENSE](LICENSE).
