// The menu, typed, plus the helpers the rest of the app reads it through.
// menu.json is the single source of truth: edit it to make this your shop.

import menuJson from './menu.json'

export type Category = 'pizza' | 'subs' | 'wings' | 'burgers' | 'salads' | 'sides' | 'drinks' | 'dessert'

export type Tag = 'vegetarian' | 'vegan' | 'spicy' | 'popular'

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
  currency: 'USD'
}

// TypeScript widens JSON imports (`category` becomes `string`), so the menu is
// typed here with an assertion. The assertion checks nothing: the tests in
// menu.test.ts are what prove menu.json has this shape. Run `pnpm test` after
// editing menu.json.
export const menu = menuJson as MenuItem[]

/** Every category, in the order the menu shows them. */
export const categories: Array<{ id: Category; label: string; note?: string }> = [
  { id: 'pizza', label: 'Pizza', note: 'Medium 14″ · Large 18″' },
  { id: 'subs', label: 'Subs' },
  { id: 'wings', label: 'Wings', note: '6 or 12 pieces' },
  { id: 'burgers', label: 'Burgers' },
  { id: 'salads', label: 'Salads' },
  { id: 'sides', label: 'Sides' },
  { id: 'drinks', label: 'Drinks' },
  { id: 'dessert', label: 'Dessert' },
]

/** Every tag an item can have. */
export const tags: Tag[] = ['vegetarian', 'vegan', 'spicy', 'popular']

/** One product per variant. A sized product's name includes the size: "Large Pepperoni Pizza". */
export function menuToProducts(items: MenuItem[]): Product[] {
  return items.flatMap((item) =>
    item.variants.map((variant) => ({
      id: variant.id,
      name: variant.label ? `${variant.label} ${item.name}` : item.name,
      price: variant.price,
      currency: 'USD' as const,
    })),
  )
}

export const products = menuToProducts(menu)

/** Looks up a variant id ("pepperoni-pizza-large") and returns it with its item. */
export function findVariant(variantId: string): { item: MenuItem; variant: Variant } | undefined {
  for (const item of menu) {
    const variant = item.variants.find((v) => v.id === variantId)
    if (variant) return { item, variant }
  }
  return undefined
}

/** Photos live in public/images, named after the item id. */
export function imagePath(item: MenuItem): string {
  return `/images/${item.id}.jpg`
}

const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })

/** 2099 → "$20.99" */
export function formatPrice(cents: number): string {
  return usd.format(cents / 100)
}
