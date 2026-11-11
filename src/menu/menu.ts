// The menu, typed, plus the helpers the rest of the app reads it through.
// menu.json holds the items: it's the source of truth for what's sold and its
// prices. `categories` below defines which category ids exist, how they're
// shown (order, label, note) and what each is in a group plan (plan, noun).

import { CURRENCY, LOCALE } from '../shop'
import menuJson from './menu.json'

/**
 * What a category's items are in a group plan (plan_group_order, src/agent/planGroupOrder.ts):
 * - `main`: mains, about one serving per person. The customer can ask for one
 *   main category, or a mix of them, by its id ("pizza", "subs" or "mix").
 * - `side`: shareable sides, one per few people.
 * - `drink`: one per person.
 * A category without a `plan` (wings, burgers) isn't planned.
 */
export type PlanRole = 'main' | 'side' | 'drink'

/** How a category is written in `categories` below. A main category also says how a plan counts its items. */
type CategoryDefinition = { id: string; label: string; note?: string } & (
  | {
      plan: 'main'
      /** How a plan's summary counts its items, one and many: "8 large pizzas". */
      noun: readonly [one: string, many: string]
    }
  | { plan?: 'side' | 'drink'; noun?: never }
)

/** Every category, in the order the menu shows them. */
export const categories = [
  { id: 'pizza', label: 'Pizza', note: 'Medium 14″ · Large 18″', plan: 'main', noun: ['pizza', 'pizzas'] },
  { id: 'subs', label: 'Subs', plan: 'main', noun: ['sub', 'subs'] },
  { id: 'wings', label: 'Wings', note: '6 or 12 pieces' },
  { id: 'burgers', label: 'Burgers' },
  { id: 'salads', label: 'Salads' },
  { id: 'sides', label: 'Sides', plan: 'side' },
  { id: 'drinks', label: 'Drinks', plan: 'drink' },
  { id: 'dessert', label: 'Dessert' },
] as const satisfies ReadonlyArray<CategoryDefinition>

/** A category id: 'pizza', 'subs' and so on. */
export type Category = (typeof categories)[number]['id']

/** What the menu shows for a category: its heading, and an optional note such as the pizza sizes. */
export type CategoryInfo = { id: Category; label: string; note?: string }

/** A category a group plan takes mains from, as `categories` lists it: pizza or subs. */
export type MainCategoryInfo = Extract<(typeof categories)[number], { plan: 'main' }>

/** The id of a category a group plan takes mains from: 'pizza' or 'subs'. */
export type MainCategory = MainCategoryInfo['id']

/** The categories a group plan takes mains from, in menu order. */
export const mainCategories: readonly MainCategoryInfo[] = categories.filter(
  (category): category is MainCategoryInfo => 'plan' in category && category.plan === 'main',
)

/** The ids of the categories with this role in a group plan, in menu order: `['sides']` for 'side'. */
export function categoriesPlannedAs(...roles: PlanRole[]): Category[] {
  return categories.flatMap((category) => ('plan' in category && roles.includes(category.plan) ? [category.id] : []))
}

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
  /**
   * Ids of items that go well with this one: sides, drinks and the like, never
   * a main (a pizza or a sub), since a card holding a plan's main counts as a
   * change to that plan. menu.test.ts checks it.
   */
  pairsWith: string[]
  /**
   * How the agent says the item in a sentence, when its name doesn't read well
   * aloud: "garlic knots" for "Garlic Knots (6)". Without it, `spokenName()`
   * gives the name in lower case.
   */
  spokenName?: string
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

/** How the agent says an item in a sentence: its `spokenName`, or else its name in lower case ("fries"). */
export function spokenName(item: MenuItem): string {
  return item.spokenName ?? item.name.toLowerCase()
}

/**
 * The size a menu card selects before the customer picks one: the variant that
 * feeds the most people (Large, 12 pc). On a tie, the first one listed wins.
 */
export function defaultVariant(item: MenuItem): Variant {
  return item.variants.reduce((largest, variant) => (variant.serves > largest.serves ? variant : largest))
}

type FoundVariant = { item: MenuItem; variant: Variant; product: Product }

// Built once at module load: the menu doesn't change while the app runs.
const byItemId = new Map(menu.map((item) => [item.id, item]))
const byVariantId = new Map<string, FoundVariant>()
for (const item of menu) {
  for (const variant of item.variants) {
    byVariantId.set(variant.id, { item, variant, product: productFor(item, variant) })
  }
}

/** Looks up an item id ("pepperoni-pizza", not a variant id). */
export function findItem(itemId: string): MenuItem | undefined {
  return byItemId.get(itemId)
}

/** Looks up a variant id ("pepperoni-pizza-large") and returns it with its item and its cart product. */
export function findVariant(variantId: string): FoundVariant | undefined {
  return byVariantId.get(variantId)
}

/** The product's name for a variant id ("Large Pepperoni Pizza"), or the id itself when it isn't on the menu. */
export function productName(variantId: string): string {
  return findVariant(variantId)?.product.name ?? variantId
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
