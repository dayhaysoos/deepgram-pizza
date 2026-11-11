// How the agent says a price out loud, in words, so neither the LLM nor the
// voice has to turn digits into speech. In a step 5 run the agent wrote
// $20.99 as "twenty oh nine nine". Every tool result with a `total` also
// carries `totalSpoken` from here, and the agent's instructions say to speak
// that (instructions.ts).
//
// Words, not "$20.99": the voice reads words as they're written, and
// Deepgram's docs don't say how Flux TTS reads a dollar amount, so there's
// nothing left for it to guess. Under a hundred dollars it's what a counter
// worker says, "twenty ninety-nine", short, with only two numbers to hear.
// From a hundred dollars it's "one hundred eighty dollars and seventy-one
// cents": "one eighty seventy-one" runs three numbers together, and the
// numbers themselves use no "and" (American English), so the one "and" marks
// where the dollars end.
//
// It's English and US dollars, as src/shop.ts is. A shop in another currency
// or language rewrites this file.

/** From this many dollars up, a price is said as "… dollars and … cents". */
const CASUAL_BELOW_DOLLARS = 100

/** 2099 → "twenty ninety-nine"; 405 → "four oh five"; 18071 → "one hundred eighty dollars and seventy-one cents". */
export function spokenPrice(cents: number): string {
  const dollars = Math.floor(cents / 100)
  const rest = cents % 100
  if (rest === 0) return `${numberWords(dollars)} ${dollars === 1 ? 'dollar' : 'dollars'}`
  const centsWords = `${numberWords(rest)} ${rest === 1 ? 'cent' : 'cents'}`
  if (dollars === 0) return centsWords
  if (dollars < CASUAL_BELOW_DOLLARS) return `${numberWords(dollars)} ${rest < 10 ? 'oh ' : ''}${numberWords(rest)}`
  return `${numberWords(dollars)} dollars and ${centsWords}`
}

const ONES = [
  'zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine',
  'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen',
]
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety']
const SCALES = [
  [1_000_000, 'million'],
  [1_000, 'thousand'],
  [100, 'hundred'],
] as const

/** A whole number from 0 up, in words: 21017 → "twenty-one thousand seventeen". */
export function numberWords(n: number): string {
  if (n < 20) return ONES[n]
  if (n < 100) return TENS[Math.floor(n / 10)] + (n % 10 > 0 ? `-${ONES[n % 10]}` : '')
  const [size, name] = SCALES.find(([size]) => n >= size) ?? SCALES[2]
  const rest = n % size
  return `${numberWords(Math.floor(n / size))} ${name}${rest > 0 ? ` ${numberWords(rest)}` : ''}`
}
