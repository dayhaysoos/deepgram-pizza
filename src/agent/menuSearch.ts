// Finding things on the menu from what the agent sent: the filters behind
// find_menu_items, and the close matches offered when an id isn't on the menu.

import { menu, type Category, type MenuItem, type Tag, type Variant } from '../menu/menu'

export type MenuFilters = {
  category?: Category
  /** Every one of these must match. */
  tags?: Tag[]
  /** In cents. */
  maxPrice?: number
  query?: string
}

/**
 * The items that pass every filter given, in menu order. With `maxPrice`, an
 * item matches when any size is within it, and only those sizes are listed.
 */
export function searchMenu(filters: MenuFilters): Array<{ item: MenuItem; variants: Variant[] }> {
  const words = filters.query ? wordsIn(filters.query) : []
  return menu.flatMap((item) => {
    if (filters.category && item.category !== filters.category) return []
    if (filters.tags && !filters.tags.every((tag) => item.tags.includes(tag))) return []
    const text = `${item.name} ${item.description} ${item.id}`.toLowerCase()
    if (!words.every((word) => mentions(text, word))) return []
    const { maxPrice } = filters
    const variants = maxPrice === undefined ? item.variants : item.variants.filter((variant) => variant.price <= maxPrice)
    return variants.length > 0 ? [{ item, variants }] : []
  })
}

/** The most close matches offered for an id that isn't on the menu. */
const MAX_CLOSE_MATCHES = 3

/**
 * Up to three menu items that look most like `text` (an id the agent made
 * up, such as "pepperoni-pizza-xl" or "margarita"), in menu order. Empty when
 * nothing is close.
 *
 * Each word in `text` that matches a word in an item's name, id or sizes
 * scores a point; the items with the top score win. Words match when they're
 * equal, when one starts with the other, or when they're a typo or two apart.
 */
export function closeMatches(text: string): MenuItem[] {
  const words = [...new Set(wordsIn(text).map(singular))]
  const scored = menu.map((item) => {
    const itemWords = wordsIn([item.id, item.name, ...item.variants.flatMap((v) => [v.id, v.label ?? ''])].join(' '))
      .map(singular)
    const score = words.filter((word) => itemWords.some((itemWord) => similar(word, itemWord))).length
    return { item, score }
  })
  const best = Math.max(...scored.map(({ score }) => score))
  if (best === 0) return []
  return scored.filter(({ score }) => score === best).slice(0, MAX_CLOSE_MATCHES).map(({ item }) => item)
}

function wordsIn(text: string): string[] {
  return text.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)
}

// "burgers" finds "Cheeseburger", but "fries" doesn't find "fried".
function mentions(text: string, word: string): boolean {
  if (text.includes(word)) return true
  return word.length > 3 && word.endsWith('s') && new RegExp(`${word.slice(0, -1)}(?![a-z])`).test(text)
}

// "margaritas" and "margarita" compare as the same word.
function singular(word: string): string {
  return word.length > 3 && word.endsWith('s') ? word.slice(0, -1) : word
}

function similar(a: string, b: string): boolean {
  if (a === b) return true
  const [shorter, longer] = a.length <= b.length ? [a, b] : [b, a]
  if (shorter.length >= 4 && longer.startsWith(shorter)) return true
  return shorter.length >= 5 && editDistance(a, b) <= 2
}

// Levenshtein distance: the fewest letters to add, drop or change to turn a into b.
function editDistance(a: string, b: string): number {
  let previous = Array.from({ length: b.length + 1 }, (_, j) => j)
  for (let i = 1; i <= a.length; i++) {
    const current = [i]
    for (let j = 1; j <= b.length; j++) {
      const change = a[i - 1] === b[j - 1] ? 0 : 1
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + change)
    }
    previous = current
  }
  return previous[b.length]
}
