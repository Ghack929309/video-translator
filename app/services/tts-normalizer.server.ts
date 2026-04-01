/**
 * Phase 14: TTS Text Normalizer
 *
 * Applied to every segment's text BEFORE sending to CosyVoice.
 * Handles acronyms, numbers, currency, symbols, and other edge cases
 * that cause CosyVoice to repeat characters or mispronounce text.
 */

// ── Acronym Detection ─────────────────────────────────────────────────

/**
 * Common acronyms that are spoken as WORDS (not spelled out).
 * These should NOT be expanded with periods.
 */
const WORD_ACRONYMS = new Set([
  "NASA", "NATO", "UNICEF", "FIFA", "UEFA", "AIDS", "LASER", "RADAR",
  "SCUBA", "ASAP", "CAPTCHA", "GIF", "JPEG", "PNG", "WIFI", "SIM",
  "PIN", "RAM", "ROM", "LAN", "WAN", "SWAT", "FEMA", "OPEC",
  "NAFTA", "HIPAA", "OSHA", "DARPA", "AWOL",
]);

/**
 * Expand letter-by-letter acronyms: "FBI" → "F.B.I."
 * Skips acronyms that are spoken as words (NASA, NATO, etc.)
 * Only targets 2-7 uppercase letter sequences.
 */
function expandAcronyms(text: string): string {
  return text.replace(/\b([A-Z]{2,7})\b/g, (match) => {
    // Already has periods (e.g., "F.B.I.") — leave it
    if (text.includes(match + ".")) return match;
    // Spoken as a word — leave it
    if (WORD_ACRONYMS.has(match)) return match;
    // Expand: "FBI" → "F.B.I."
    return match.split("").join(".") + ".";
  });
}

// ── Number to Words (English) ─────────────────────────────────────────

const ONES = [
  "", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine",
  "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen",
  "seventeen", "eighteen", "nineteen",
];
const TENS = [
  "", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety",
];

function numberToWordsEn(n: number): string {
  if (n < 0) return "negative " + numberToWordsEn(-n);
  if (n === 0) return "zero";
  if (n < 20) return ONES[n];
  if (n < 100) {
    const t = TENS[Math.floor(n / 10)];
    const o = n % 10;
    return o ? `${t}-${ONES[o]}` : t;
  }
  if (n < 1000) {
    const h = Math.floor(n / 100);
    const rem = n % 100;
    return rem ? `${ONES[h]} hundred ${numberToWordsEn(rem)}` : `${ONES[h]} hundred`;
  }
  if (n < 1_000_000) {
    const th = Math.floor(n / 1000);
    const rem = n % 1000;
    const thStr = numberToWordsEn(th) + " thousand";
    return rem ? `${thStr} ${numberToWordsEn(rem)}` : thStr;
  }
  if (n < 1_000_000_000) {
    const m = Math.floor(n / 1_000_000);
    const rem = n % 1_000_000;
    const mStr = numberToWordsEn(m) + " million";
    return rem ? `${mStr} ${numberToWordsEn(rem)}` : mStr;
  }
  // For very large numbers, just return digits
  return String(n);
}

/**
 * Convert standalone numbers to words (for numbers up to 999,999).
 * Large numbers (1M+) are left as digits.
 */
function expandNumbers(text: string, lang: string): string {
  // Skip for CJK languages — they have their own number systems
  if (["ja", "zh", "ko"].includes(lang)) return text;

  return text.replace(/\b(\d{1,6})\b/g, (match) => {
    const n = parseInt(match, 10);
    if (isNaN(n) || n > 999_999) return match;
    return numberToWordsEn(n);
  });
}

// ── Currency ──────────────────────────────────────────────────────────

const CURRENCY_MAP: Record<string, string> = {
  "$": "dollars",
  "€": "euros",
  "£": "pounds",
  "¥": "yen",
  "₹": "rupees",
  "₩": "won",
  "₽": "rubles",
};

function expandCurrency(text: string, lang: string): string {
  if (["ja", "zh", "ko"].includes(lang)) return text;

  return text.replace(/([$€£¥₹₩₽])\s?(\d[\d,]*\.?\d*)/g, (_match, symbol: string, amount: string) => {
    const currencyName = CURRENCY_MAP[symbol] ?? symbol;
    const num = parseFloat(amount.replace(/,/g, ""));
    if (isNaN(num) || num > 999_999) return `${amount} ${currencyName}`;
    return `${numberToWordsEn(Math.floor(num))}${num % 1 > 0 ? ` point ${amount.split(".")[1]}` : ""} ${currencyName}`;
  });
}

// ── Percentages ───────────────────────────────────────────────────────

function expandPercentages(text: string, lang: string): string {
  if (["ja", "zh", "ko"].includes(lang)) return text;

  return text.replace(/(\d+\.?\d*)\s?%/g, (_match, num: string) => {
    const n = parseFloat(num);
    if (isNaN(n)) return _match;
    if (num.includes(".")) {
      const [whole, dec] = num.split(".");
      const wholeWord = numberToWordsEn(parseInt(whole, 10));
      return `${wholeWord} point ${dec} percent`;
    }
    return `${numberToWordsEn(n)} percent`;
  });
}

// ── Ordinals ──────────────────────────────────────────────────────────

const ORDINAL_MAP: Record<string, string> = {
  "1st": "first", "2nd": "second", "3rd": "third", "4th": "fourth",
  "5th": "fifth", "6th": "sixth", "7th": "seventh", "8th": "eighth",
  "9th": "ninth", "10th": "tenth", "11th": "eleventh", "12th": "twelfth",
  "13th": "thirteenth", "20th": "twentieth", "21st": "twenty-first",
  "30th": "thirtieth", "100th": "hundredth",
};

function expandOrdinals(text: string, lang: string): string {
  if (["ja", "zh", "ko"].includes(lang)) return text;

  return text.replace(/\b(\d{1,3})(st|nd|rd|th)\b/gi, (match) => {
    const lower = match.toLowerCase();
    return ORDINAL_MAP[lower] ?? match;
  });
}

// ── Abbreviations ─────────────────────────────────────────────────────

const ABBREVIATIONS: Record<string, string> = {
  "Dr.": "Doctor",
  "Mr.": "Mister",
  "Mrs.": "Missus",
  "Ms.": "Miss",
  "Jr.": "Junior",
  "Sr.": "Senior",
  "vs.": "versus",
  "vs": "versus",
  "etc.": "et cetera",
  "approx.": "approximately",
  "dept.": "department",
  "govt.": "government",
  "min.": "minutes",
  "sec.": "seconds",
  "hr.": "hour",
  "hrs.": "hours",
  "inc.": "Incorporated",
  "corp.": "Corporation",
  "ltd.": "Limited",
  "Ave.": "Avenue",
  "Blvd.": "Boulevard",
  "St.": "Street",
};

function expandAbbreviations(text: string): string {
  let result = text;
  for (const [abbr, full] of Object.entries(ABBREVIATIONS)) {
    // Case-insensitive replacement, preserving word boundaries
    const escaped = abbr.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    result = result.replace(new RegExp(`\\b${escaped}`, "gi"), full);
  }
  return result;
}

// ── Cleanup ───────────────────────────────────────────────────────────

/**
 * Clean up text artifacts that cause CosyVoice to produce repeated sounds.
 */
function cleanupText(text: string): string {
  let result = text;

  // Normalize unicode quotes/dashes to ASCII
  result = result.replace(/[""]/g, '"');
  result = result.replace(/['']/g, "'");
  result = result.replace(/[–—]/g, " - ");
  result = result.replace(/…/g, "...");

  // Remove repeated punctuation (except ellipsis)
  result = result.replace(/([!?]){2,}/g, "$1");

  // Remove hashtags
  result = result.replace(/#\w+/g, "");

  // Remove URLs
  result = result.replace(/https?:\/\/\S+/gi, "");

  // Remove email addresses
  result = result.replace(/\S+@\S+\.\S+/g, "");

  // Collapse multiple spaces
  result = result.replace(/\s{2,}/g, " ");

  // Trim
  result = result.trim();

  return result;
}

// ── Main Export ────────────────────────────────────────────────────────

/**
 * Normalize text for TTS synthesis.
 * Applied to every segment before sending to CosyVoice or Fish Audio.
 *
 * @param text - The translated text to normalize
 * @param lang - ISO 639-1 language code of the target language
 * @returns Normalized text ready for TTS
 */
export function normalizeForTTS(text: string, lang: string): string {
  if (!text || text.trim().length === 0) return text;

  let result = text;

  // Order matters: expand currency/percentages before general numbers
  result = expandCurrency(result, lang);
  result = expandPercentages(result, lang);
  result = expandOrdinals(result, lang);
  result = expandAbbreviations(result);
  result = expandAcronyms(result);
  result = expandNumbers(result, lang);
  result = cleanupText(result);

  return result;
}
