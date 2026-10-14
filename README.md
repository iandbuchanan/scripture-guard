# scripture-guard

**Keep a language model from writing Scripture.**

Language models quote the Bible from memory, and memory is not a Bible. They blend translations,
drop words, and invent verses that sound right. If your application shows Scripture, the safe
rule is simple: **every word of Scripture a reader sees comes from a Bible text you retrieved,
never from the model.** The model may choose a reference and talk *about* a passage. It may not
reproduce it.

Prompts can ask for that. This library checks it. It is small, has no dependencies, and works
with any model and any Bible source.

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

## Limits

- It is lexical. It catches repeated wording, not a loose paraphrase. Ask for no paraphrase in
  the prompt as well.
- It checks against the passage you give it. Output with no passage in scope needs
  `citedReferences()` and `hasLongQuotedSpan()`, and they cannot catch an uncited, unquoted verse.
- `citedReferences()` matches English book titles and Arabic numerals.

## License

MIT. See [LICENSE](LICENSE).
