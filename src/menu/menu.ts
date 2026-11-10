// The menu, typed, plus the helpers the rest of the app reads it through.
// menu.json holds the items: it's the source of truth for what's sold and its
// prices. `categories` below defines which category ids exist and how they're
// shown (order, label, note).

import { CURRENCY, LOCALE } from '../shop'
import menuJson from './menu.json'

/** Every category, in the order the menu shows them. */
export const categories = [
  { id: 'pizza', label: 'Pizza', note: 'Medium 14″ · Large 18″' },
  { id: 'subs', label: 'Subs' },
  { id: 'wings', label: 'Wings', note: '6 or 12 pieces' },
  { id: 'burgers', label: 'Burgers' },
  { id: 'salads', label: 'Salads' },
  { id: 'sides', label: 'Sides' },
  { id: 'drinks', label: 'Drinks' },
  { id: 'dessert', label: 'Dessert' },
] as const satisfies ReadonlyArray<{ id: string; label: string; note?: string }>

/** A category id: 'pizza', 'subs' and so on. */
export type Category = (typeof categories)[number]['id']

/** What the menu shows for a category: its heading, and an optional note such as the pizza sizes. */
export type CategoryInfo = { id: Category; label: string; note?: string }

/** Every tag an item can have. */
export const tags = ['vegetarian', 'vegan', 'spicy', 'popular'] as const

export type Tag = (typeof tags)[number]

/** One orderable size of an item. An item with one size has one variant whose id is the item id. */
export type Variant = {
  id: string
  /** The size, such as "Large" or "12 pc". Only sized items have one. */
  label?: string
  /** In cents. */
  price: number
  /** How many people one of these feeds. */
  serves: number
}

export type MenuItem = {
  id: string
  name: string
  category: Category
  description: string
  tags: Tag[]
  variants: Variant[]
  /** Ids of items that go well with this one. */
  pairsWith: string[]
}

/** The flat product the cart and `validateCartItems` use: one per variant. */
export type Product = {
  id: string
  name: string
  price: number
  currency: typeof CURRENCY
}

// TypeScript widens JSON imports (`category` becomes `string`), so the menu is
// typed here with an assertion. The assertion checks nothing: the tests in
// menu.test.ts are what prove menu.json has this shape. Run `pnpm test` after
// editing menu.json.
export const menu = menuJson as MenuItem[]

/** The cart product for one variant. A sized product's name includes the size: "Large Pepperoni Pizza". */
export function productFor(item: MenuItem, variant: Variant): Product {
  return {
    id: variant.id,
    name: variant.label ? `${variant.label} ${item.name}` : item.name,
    price: variant.price,
    currency: CURRENCY,
  }
}

/** One product per variant, in menu order. */
export function menuToProducts(items: MenuItem[]): Product[] {
  return items.flatMap((item) => item.variants.map((variant) => productFor(item, variant)))
}

export const products = menuToProducts(menu)

/**
 * The size a menu card selects before the customer picks one: the variant that
 * feeds the most people (Large, 12 pc). On a tie, the first one listed wins.
 */
export function defaultVariant(item: MenuItem): Variant {
  return item.variants.reduce((largest, variant) => (variant.serves > largest.serves ? variant : largest))
}

type FoundVariant = { item: MenuItem; variant: Variant; product: Product }

// Built once at module load: the menu doesn't change while the app runs.
const byVariantId = new Map<string, FoundVariant>()
for (const item of menu) {
  for (const variant of item.variants) {
    byVariantId.set(variant.id, { item, variant, product: productFor(item, variant) })
  }
}

/** Looks up a variant id ("pepperoni-pizza-large") and returns it with its item and its cart product. */
export function findVariant(variantId: string): FoundVariant | undefined {
  return byVariantId.get(variantId)
}

/** Photos live in public/images, named after the item id. */
export function imagePath(item: MenuItem): string {
  return `/images/${item.id}.jpg`
}

const priceFormat = new Intl.NumberFormat(LOCALE, { style: 'currency', currency: CURRENCY })

/** 2099 → "$20.99" */
export function formatPrice(cents: number): string {
  return priceFormat.format(cents / 100)
}
