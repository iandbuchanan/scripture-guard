// scripture-guard: keep a language model from writing Scripture.
//
// The invariant this library enforces: every word of Scripture a reader sees came from a Bible
// text you retrieved, never from the model. The model may choose a reference and may talk about
// a passage; it may not reproduce the passage, quoted, paraphrased closely, or "from memory".
//
// Everything here is a detector on the way out (or, for strikePassage, a filter on the way in),
// not a prompt instruction. Prompts ask; these check. No dependencies.

/** A book of the Bible as your Bible source names it: an id (USFM, e.g. "JHN") and its title. */
export type BookRef = { id: string; title: string };

/** Six consecutive words is well past common phrases like "the Son of God". */
export const DEFAULT_RUN = 6;
/** An unverifiable quoted span this long is treated as Scripture. */
export const DEFAULT_QUOTED_RUN = 10;
/** What strikePassage() puts in place of each struck stretch, unless told otherwise. */
export const DEFAULT_STRUCK = "[passage]";

// Both sides of every comparison go through this, and it is deliberately indifferent to how the
// retrieval layer formats a passage. Markup, HTML entities and verse numbers are *removed* rather
// than matched on, so nothing here depends on the shape of your Bible API's output.
//
// That independence is the point. If verse markers were stripped as one literal format ("[14]")
// and the source ever changed (a renamed span class, a plain-text endpoint, a <sup> that stops
// matching), verse numbers would arrive bare and "14And God said" would tokenize as "14and",
// which never matches the model's clean "and". The n-grams shift, the guard silently catches
// less, and nothing errors. A mechanical change on the retrieval side must not weaken this.
//
// Digits go entirely: Scripture carries its quoting signal in words, not numerals, so dropping
// them makes verse-number format irrelevant in any shape. Where a number sat between two words,
// the words close up, which can only make a run easier to detect: the safe direction for a guard.
// Accents are folded ("é" → "e") so the same text compares equal however it was encoded.
export function words(s: string): string[] {
  return s
    .normalize("NFKD")
    .replace(/\p{M}/gu, "") // combining marks left by the decomposition
    .toLowerCase()
    .replace(/<[^>]*>/g, " ") // tags, if any survive upstream
    .replace(/&(?:[a-z]+|#\d+);/g, " ") // entities, decoded or not ("&amp;" must not become "amp")
    .replace(/[’']/g, "") // "god's" and "gods" are the same word here
    .replace(/[^\p{L}\s]/gu, " ") // digits and punctuation alike
    .split(/\s+/)
    .filter(Boolean);
}

function ngrams(ws: string[], run: number): Set<string> {
  const grams = new Set<string>();
  for (let i = 0; i + run <= ws.length; i++) grams.add(ws.slice(i, i + run).join(" "));
  return grams;
}

/**
 * True when `output` repeats `run` or more consecutive words of `passageText`.
 * Use it on every model-written string that reaches a reader while a passage is in scope.
 */
export function quotesPassage(output: string, passageText: string, run = DEFAULT_RUN): boolean {
  const p = words(passageText);
  if (p.length < run) return false;
  const grams = ngrams(p, run);
  const o = words(output);
  for (let i = 0; i + run <= o.length; i++) if (grams.has(o.slice(i, i + run).join(" "))) return true;
  return false;
}

export type StrikeOptions = { run?: number; replacement?: string; gap?: number };

/**
 * `text` with every stretch that repeats the passage struck out, for text that goes *into* a
 * prompt: a transcript of people reading aloud holds the passage itself, and a model given it
 * will echo it. A stretch is a run of `run`+ words shared with the passage, as quotesPassage()
 * finds it; up to `gap` stray words between two struck stretches (a misheard word mid-reading)
 * go with them. What's left carries no run the guard would flag.
 */
export function strikePassage(text: string, passageText: string, options: StrikeOptions = {}): string {
  const { run = DEFAULT_RUN, replacement = DEFAULT_STRUCK, gap = 3 } = options;
  const p = words(passageText);
  if (p.length < run) return text;
  const grams = ngrams(p, run);

  // Each normalized word, and the original token it came from.
  const tokens = text.split(/\s+/).filter(Boolean);
  const ws: string[] = [];
  const from: number[] = [];
  tokens.forEach((t, i) => words(t).forEach((w) => (ws.push(w), from.push(i))));

  const struck = new Array<boolean>(tokens.length).fill(false);
  for (let i = 0; i + run <= ws.length; i++) {
    if (grams.has(ws.slice(i, i + run).join(" "))) for (let k = i; k < i + run; k++) struck[from[k]] = true;
  }
  for (let i = 0, last = -1; i < tokens.length; i++) {
    if (!struck[i]) continue;
    if (last >= 0 && i - last - 1 <= gap) for (let k = last + 1; k < i; k++) struck[k] = true;
    last = i;
  }
  return tokens
    .flatMap((t, i) => (!struck[i] ? [t] : i > 0 && struck[i - 1] ? [] : [replacement]))
    .join(" ");
}

// Verse-level citations written in prose ("John 3:16", "1 John 2:1", "Romans 8:28-30", "Song of
// Songs 2:1", "Romans 8:28–30"). Book-and-chapter mentions ("read Psalms 23") are deliberately
// ignored: a pointer isn't a quote.
const CITATION = /\b((?:[1-3]\s*)?[A-Z][a-z]+(?:\s+(?:of\s+)?[A-Z][a-z]+)?)\s+(\d{1,3}):(\d{1,3})(?:\s*[-–—]\s*(\d{1,3}))?/g;

// What people write vs. what a Bible version titles the book. Both directions where versions
// differ ("Song of Songs" in one, "Song of Solomon" in another), so either spelling finds either.
const BOOK_ALIASES: Record<string, string> = {
  psalm: "psalms",
  psalms: "psalm",
  "song of solomon": "song of songs",
  "song of songs": "song of solomon",
  revelations: "revelation",
};

/**
 * Verse-level citations in `output`, as USFM references ("JHN.3.16", "ROM.8.28-30"), resolved
 * against `books`. Retrieve those passages and run quotesPassage() against them when the output
 * had no passage of its own to be checked against.
 */
export function citedReferences(output: string, books: BookRef[] = PROTESTANT_CANON): string[] {
  const byTitle = new Map(books.map((b) => [b.title.toLowerCase().replace(/\s+/g, " "), b.id]));
  const lookup = (name: string) => byTitle.get(name) ?? byTitle.get(BOOK_ALIASES[name]);
  const out = new Set<string>();
  for (const m of output.matchAll(CITATION)) {
    // The leading words may be ordinary prose the pattern swallowed ("As John 3:16 says", "the
    // Gospel of John 3:16"), so a miss on the full capture retries with each leading word dropped
    // in turn. "1 John" and "Song of Songs" still match on the first try.
    const name = m[1].toLowerCase().replace(/\s+/g, " ").trim().split(" ");
    let id: string | undefined;
    for (let i = 0; i < name.length && !id; i++) id = lookup(name.slice(i).join(" "));
    if (!id) continue;
    out.add(`${id}.${Number(m[2])}.${Number(m[3])}${m[4] ? `-${Number(m[4])}` : ""}`);
  }
  return [...out];
}

const DOUBLE_QUOTED = /["“]([^"”]{10,})["”]/g;
// Single quotes double as apostrophes, so a mark between two letters ("God's", "don't") is part of
// the span, never its end, and a span only opens or closes where no letter or digit touches the
// mark from outside. "the disciples' hearts … the apostles' teaching" is therefore not a span.
const SINGLE_QUOTED = /(?<![\p{L}\p{N}])['‘]((?:[^'‘’]|(?<=\p{L})['’](?=\p{L}))+)['’](?![\p{L}\p{N}])/gu;

/**
 * True when `output` holds a run of `minWords`+ words inside quotation marks. For output with no
 * retrieved passage to check against: a model told never to quote Scripture that still puts a
 * long span in quotes is either quoting Scripture from memory or quoting something it shouldn't.
 */
export function hasLongQuotedSpan(output: string, minWords = DEFAULT_QUOTED_RUN): boolean {
  for (const m of output.matchAll(DOUBLE_QUOTED)) if (words(m[1]).length >= minWords) return true;
  for (const m of output.matchAll(SINGLE_QUOTED)) if (words(m[1]).length >= minWords) return true;
  return false;
}

/** Thrown by generateWithoutQuoting() when every attempt quoted the passage. */
export class ScriptureQuoteError extends Error {
  constructor(message = "The model output quoted the passage on every attempt.") {
    super(message);
    this.name = "ScriptureQuoteError";
  }
}

/** The note passed to `generate` on a retry, unless told otherwise. Add it to your prompt. */
export const DEFAULT_REWRITE_NOTE =
  "Your previous answer repeated the passage's own words. Rewrite it without quoting or closely paraphrasing the passage; point to verses by number instead.";

export type GenerateOptions<T> = {
  /** Calls the model. `note` is "" on the first attempt and the rewrite note after that. */
  generate: (note: string) => Promise<T>;
  /** Every string in the result that reaches a reader. A field left out here is not checked. */
  texts: (result: T) => string[];
  /** The retrieved passage text the output must not repeat. */
  passageText: string;
  attempts?: number;
  run?: number;
  rewriteNote?: string;
};

/**
 * Calls the model, and regenerates with a rewrite note when the output quotes the passage.
 * Throws ScriptureQuoteError after `attempts` tries (2 by default) rather than ever returning
 * output that quotes it.
 */
export async function generateWithoutQuoting<T>(options: GenerateOptions<T>): Promise<T> {
  const { generate, texts, passageText, attempts = 2, run = DEFAULT_RUN, rewriteNote = DEFAULT_REWRITE_NOTE } = options;
  let note = "";
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const result = await generate(note);
    if (!texts(result).some((t) => quotesPassage(t, passageText, run))) return result;
    note = rewriteNote;
  }
  throw new ScriptureQuoteError();
}

/** The 66 books of the Protestant canon: USFM ids with common English titles. */
export const PROTESTANT_CANON: BookRef[] = [
  ["GEN", "Genesis"], ["EXO", "Exodus"], ["LEV", "Leviticus"], ["NUM", "Numbers"], ["DEU", "Deuteronomy"],
  ["JOS", "Joshua"], ["JDG", "Judges"], ["RUT", "Ruth"], ["1SA", "1 Samuel"], ["2SA", "2 Samuel"],
  ["1KI", "1 Kings"], ["2KI", "2 Kings"], ["1CH", "1 Chronicles"], ["2CH", "2 Chronicles"], ["EZR", "Ezra"],
  ["NEH", "Nehemiah"], ["EST", "Esther"], ["JOB", "Job"], ["PSA", "Psalms"], ["PRO", "Proverbs"],
  ["ECC", "Ecclesiastes"], ["SNG", "Song of Songs"], ["ISA", "Isaiah"], ["JER", "Jeremiah"], ["LAM", "Lamentations"],
  ["EZK", "Ezekiel"], ["DAN", "Daniel"], ["HOS", "Hosea"], ["JOL", "Joel"], ["AMO", "Amos"],
  ["OBA", "Obadiah"], ["JON", "Jonah"], ["MIC", "Micah"], ["NAM", "Nahum"], ["HAB", "Habakkuk"],
  ["ZEP", "Zephaniah"], ["HAG", "Haggai"], ["ZEC", "Zechariah"], ["MAL", "Malachi"],
  ["MAT", "Matthew"], ["MRK", "Mark"], ["LUK", "Luke"], ["JHN", "John"], ["ACT", "Acts"],
  ["ROM", "Romans"], ["1CO", "1 Corinthians"], ["2CO", "2 Corinthians"], ["GAL", "Galatians"], ["EPH", "Ephesians"],
  ["PHP", "Philippians"], ["COL", "Colossians"], ["1TH", "1 Thessalonians"], ["2TH", "2 Thessalonians"],
  ["1TI", "1 Timothy"], ["2TI", "2 Timothy"], ["TIT", "Titus"], ["PHM", "Philemon"], ["HEB", "Hebrews"],
  ["JAS", "James"], ["1PE", "1 Peter"], ["2PE", "2 Peter"], ["1JN", "1 John"], ["2JN", "2 John"],
  ["3JN", "3 John"], ["JUD", "Jude"], ["REV", "Revelation"],
].map(([id, title]) => ({ id, title }));
