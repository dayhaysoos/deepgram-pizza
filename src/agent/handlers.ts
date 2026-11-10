// What each tool does when the agent calls it. The handlers run in the browser
// and reach the cart, the screen and checkout only through the ports passed to
// createToolHandlers, so tests can run them with a plain cart and fakes.
//
// Two rules shape this file (AGENTS.md, "Architecture"):
// - Tools recover; they don't throw. The agent can send anything, so every
//   argument is checked, and a problem comes back as `{ message }`: a short
//   sentence the agent can act on. A thrown error would end its turn in silence.
// - Every cart tool returns the cart summary. In React, a use-shopping-cart
//   action updates the store at once, but the cart a component holds stays as
//   it was until the next render, and the hook has no way to read the store
//   directly. So a handler reads the cart once, works out the cart after its
//   change itself, makes the change, and summarizes the cart it worked out.
//   handlers.test.ts checks that this always matches what the store holds.

import type { CartDetails } from 'use-shopping-cart/core'
import { CHECKOUT_UNAVAILABLE, type CheckoutResult } from '../checkout/checkout'
import { categories, findVariant, formatPrice, menu, tags, type Category, type Product, type Tag } from '../menu/menu'
import { MAX_LINE_QUANTITY } from '../shop'
import { quantitiesOf, summarizeCart, type CartSummary, type Quantities } from './cartSummary'
import { closeMatches, searchMenu, type MenuFilters } from './menuSearch'
import { MAX_LINES_PER_CALL, type ToolName } from './tools'

/** A short message the agent can act on, returned instead of throwing. */
export type Recovery = { message: string }

/** The cart: use-shopping-cart's actions, plus the cart as it is now. */
export type CartPort = {
  /** The cart as of the last render: `cartDetails` from `useShoppingCart()`. */
  cartDetails(): CartDetails
  addItem(product: Product, options: { count: number }): void
  setItemQuantity(id: string, quantity: number): void
  removeItem(id: string): void
  clearCart(): void
}

/** What the tools change on screen. */
export type UiPort = {
  /** Lights up these menu cards, by item id. An empty list clears the highlights. */
  highlight(itemIds: string[]): void
  /** Opens the suggestion card, replacing any card already open. */
  showSuggestions(card: SuggestionCard): void
  openCart(): void
  /** Leaves for Stripe Checkout, once the agent has finished speaking. */
  goToCheckout(url: string): void
}

export type SuggestionCard = {
  title: string
  reason?: string
  lines: Array<{ id: string; name: string; quantity: number; unitPrice: string; lineTotal: string }>
  /** What every line together costs. */
  total: string
}

export type ToolPorts = {
  cart: CartPort
  ui: UiPort
  /** Starts checkout for the cart: the `createCheckoutSession` server function in the app. */
  checkout(cartDetails: CartDetails): Promise<CheckoutResult>
}

/** What find_menu_items returns. */
export type FoundItems = {
  items: Array<{
    id: string
    name: string
    category: Category
    description: string
    tags: Tag[]
    variants: Array<{ id: string; label?: string; price: string; serves: number }>
  }>
  /** Set when nothing matched. */
  message?: string
}

export type ToolResult = CartSummary | Recovery | FoundItems | { shown: true; total: string } | { ok: true }

/**
 * Runs one tool. Takes the arguments the agent sent, as an object or as the
 * JSON string Deepgram delivers, and never rejects.
 */
export type ToolHandler = (args: unknown) => Promise<ToolResult>

const BAD_QUANTITY = `The quantity has to be a whole number from 1 to ${MAX_LINE_QUANTITY}.`
const EMPTY_CART = 'The cart is empty.'

/** One handler per tool, keyed by tool name. */
export function createToolHandlers({ cart, ui, checkout }: ToolPorts): Record<ToolName, ToolHandler> {
  // The drawer opens on its own the first time a voice change adds an item, so
  // the customer sees it happen. After that it's theirs to open and close.
  let drawerOpened = false
  function openDrawerOnce() {
    if (drawerOpened) return
    drawerOpened = true
    ui.openCart()
  }

  return {
    find_menu_items: recovering((args) => {
      const filters = readFilters(args)
      if ('message' in filters) return filters
      const found = searchMenu(filters)
      ui.highlight(found.map(({ item }) => item.id))
      const items = found.map(({ item, variants }) => ({
        id: item.id,
        name: item.name,
        category: item.category,
        description: item.description,
        tags: [...item.tags],
        variants: variants.map((variant) => ({
          id: variant.id,
          ...(variant.label ? { label: variant.label } : {}),
          price: formatPrice(variant.price),
          serves: variant.serves,
        })),
      }))
      if (items.length > 0) return { items }
      return { items, message: 'Nothing on the menu matches. Try fewer filters, or offer the closest thing we have.' }
    }),

    show_suggestions: recovering((args) => {
      // Not checked against the cart: it can change before the customer taps
      // Add all, and Add all checks again then.
      const checked = checkLines(args.items, {})
      if ('message' in checked) return { message: `Nothing was shown. ${checked.message}` }
      const lines = checked.lines.map(({ product, quantity }) => ({
        id: product.id,
        name: product.name,
        quantity,
        unitPrice: formatPrice(product.price),
        lineTotal: formatPrice(product.price * quantity),
      }))
      const total = formatPrice(checked.lines.reduce((sum, { product, quantity }) => sum + product.price * quantity, 0))
      const reason = text(args.reason)
      ui.showSuggestions({ title: text(args.title) ?? 'Suggestions', ...(reason ? { reason } : {}), lines, total })
      return { shown: true, total }
    }),

    add_item: recovering((args) => {
      const quantities = quantitiesOf(cart.cartDetails())
      const line = checkLine(args.id, args.quantity, quantities)
      if ('message' in line) return line
      cart.addItem(line.product, { count: line.quantity })
      openDrawerOnce()
      return summarizeCart(withLineAdded(quantities, line))
    }),

    add_items: recovering((args) => {
      const result = addLines(cart, args.items)
      if (!('message' in result)) openDrawerOnce()
      return result
    }),

    set_quantity: recovering(({ id, quantity }) => {
      const quantities = quantitiesOf(cart.cartDetails())
      if (!isInCart(quantities, id)) return notInCart(quantities)
      if (!isLineQuantity(quantity)) return { message: `${BAD_QUANTITY} To take it out of the cart, use remove_item.` }
      cart.setItemQuantity(id, quantity)
      return summarizeCart({ ...quantities, [id]: quantity })
    }),

    remove_item: recovering(({ id }) => {
      const quantities = quantitiesOf(cart.cartDetails())
      if (!isInCart(quantities, id)) return notInCart(quantities)
      cart.removeItem(id)
      return summarizeCart(Object.fromEntries(Object.entries(quantities).filter(([lineId]) => lineId !== id)))
    }),

    view_cart: recovering(() => summarizeCart(quantitiesOf(cart.cartDetails()))),

    clear_cart: recovering(() => {
      cart.clearCart()
      return summarizeCart({})
    }),

    checkout: recovering(async () => {
      const cartDetails = cart.cartDetails()
      if (Object.keys(cartDetails).length === 0) return { message: EMPTY_CART }
      let result: CheckoutResult
      try {
        result = await checkout(cartDetails)
      } catch (error) {
        // The request itself failed: offline, or the server is down.
        console.error('Checkout request failed:', error)
        return { message: CHECKOUT_UNAVAILABLE }
      }
      if ('message' in result) return result
      ui.goToCheckout(result.url)
      return { ok: true }
    }),
  }
}

/**
 * Adds every line or none. All lines are checked first (on the menu, a size
 * given, a good quantity, and at most 20 per line counting what's in the cart),
 * and lines with the same id are added up. add_items uses it, and so does the
 * suggestion card's Add all, so both behave the same.
 */
export function addLines(cart: Pick<CartPort, 'cartDetails' | 'addItem'>, items: unknown): CartSummary | Recovery {
  const quantities = quantitiesOf(cart.cartDetails())
  const checked = checkLines(items, quantities)
  if ('message' in checked) return { message: `Nothing was added. ${checked.message}` }
  let next = quantities
  for (const line of checked.lines) {
    cart.addItem(line.product, { count: line.quantity })
    next = withLineAdded(next, line)
  }
  return summarizeCart(next)
}

type CheckedLine = { product: Product; quantity: number }

/** Checks a list of lines to add, merging repeated ids. A problem names its line. */
function checkLines(items: unknown, inCart: Quantities): { lines: CheckedLine[] } | Recovery {
  if (!Array.isArray(items) || items.length === 0) {
    return { message: 'Send items as a list of lines, each with an id and a quantity.' }
  }
  if (items.length > MAX_LINES_PER_CALL) {
    return { message: `That's ${items.length} lines, and one call takes at most ${MAX_LINES_PER_CALL}.` }
  }
  const merged = new Map<string, CheckedLine>()
  for (const [index, item] of items.entries()) {
    const { id, quantity }: Record<string, unknown> = isRecord(item) ? item : {}
    const earlier = typeof id === 'string' ? (merged.get(id)?.quantity ?? 0) : 0
    const line = checkLine(id, quantity, inCart, earlier)
    if ('message' in line) {
      const label = typeof id === 'string' ? `Line ${index + 1} (${JSON.stringify(id)})` : `Line ${index + 1}`
      return { message: `${label}: ${line.message}` }
    }
    merged.set(line.product.id, { product: line.product, quantity: earlier + line.quantity })
  }
  return { lines: [...merged.values()] }
}

/** Checks one line to add. `earlier` is how many of the same id earlier lines in this call add. */
function checkLine(id: unknown, quantity: unknown, inCart: Quantities, earlier = 0): CheckedLine | Recovery {
  if (typeof id !== 'string' || id === '') return { message: "The id is missing. Send the item's id from the menu." }
  const found = findVariant(id)
  if (!found) return notOnMenu(id)
  if (!isLineQuantity(quantity)) return { message: BAD_QUANTITY }
  const already = quantityOf(inCart, id)
  const total = already + earlier + quantity
  if (total > MAX_LINE_QUANTITY) {
    const now = already > 0 ? ` There are ${already} in the cart now.` : ''
    return {
      message: `That would make ${total} × ${found.product.name}, and a line holds at most ${MAX_LINE_QUANTITY}.${now}`,
    }
  }
  return { product: found.product, quantity }
}

function notOnMenu(id: string): Recovery {
  // A sized item's id without the size, such as "pepperoni-pizza".
  const item = menu.find((menuItem) => menuItem.id === id)
  if (item) {
    const sizes = item.variants.map((variant) => (variant.label ?? variant.id).toLowerCase())
    return { message: `${item.name} comes in ${orList(sizes)}. Which one?` }
  }
  const matches = closeMatches(id)
  if (matches.length === 0) {
    return { message: "That's not on the menu, and nothing on it is close. Offer something we do have." }
  }
  const named = matches.map((match) => `${match.name} (${orList(match.variants.map((variant) => variant.id))})`)
  return { message: `That's not on the menu. Close matches: ${named.join(', ')}.` }
}

function notInCart(quantities: Quantities): Recovery {
  const { lines } = summarizeCart(quantities)
  if (lines.length === 0) return { message: `That isn't in the cart. ${EMPTY_CART}` }
  const listed = lines.map((line) => `${line.quantity} × ${line.name} (${line.id})`).join(', ')
  return { message: `That isn't in the cart. The cart has: ${listed}.` }
}

/** Reads the filters find_menu_items was given. Null counts as not given. */
function readFilters(args: Record<string, unknown>): MenuFilters | Recovery {
  const filters: MenuFilters = {}
  if (args.category != null) {
    if (!isCategory(args.category)) {
      const ids = categories.map((category) => category.id).join(', ')
      return { message: `There's no ${JSON.stringify(String(args.category))} category. The categories are: ${ids}.` }
    }
    filters.category = args.category
  }
  if (args.tags != null) {
    const list: unknown[] = Array.isArray(args.tags) ? args.tags : [args.tags]
    for (const tag of list) {
      if (!isTag(tag)) return { message: `There's no ${JSON.stringify(String(tag))} tag. The tags are: ${tags.join(', ')}.` }
    }
    if (list.length > 0) filters.tags = list.filter(isTag)
  }
  if (args.max_price != null) {
    const dollars = args.max_price
    if (typeof dollars !== 'number' || !Number.isFinite(dollars) || dollars <= 0) {
      return { message: 'max_price has to be a price in dollars above zero, such as 10.' }
    }
    filters.maxPrice = Math.round(dollars * 100)
  }
  const query = text(args.query)
  if (query) filters.query = query
  if (Object.keys(filters).length === 0) return { message: 'Give at least one filter: category, tags, max_price or query.' }
  return filters
}

/**
 * Wraps a handler so it takes raw arguments and never throws. Nothing in the
 * handlers above should throw, but if the cart library does (say, the cart a
 * handler read was stale), the agent still gets a sentence to act on.
 */
function recovering(
  handler: (args: Record<string, unknown>) => ToolResult | Promise<ToolResult>,
): ToolHandler {
  return async (args) => {
    try {
      return await handler(readArgs(args))
    } catch (error) {
      console.error('A tool handler failed:', error)
      return { message: "That didn't work. Call view_cart to see the cart, then try again." }
    }
  }
}

// Deepgram delivers a function call's arguments as a JSON string.
function readArgs(args: unknown): Record<string, unknown> {
  let value = args
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value)
    } catch {
      return {}
    }
  }
  return isRecord(value) ? value : {}
}

function withLineAdded(quantities: Quantities, { product, quantity }: CheckedLine): Quantities {
  return { ...quantities, [product.id]: quantityOf(quantities, product.id) + quantity }
}

// Object.hasOwn, so an id like "constructor" isn't found on Object.prototype.
function isInCart(quantities: Quantities, id: unknown): id is string {
  return typeof id === 'string' && Object.hasOwn(quantities, id)
}

function quantityOf(quantities: Quantities, id: string): number {
  return Object.hasOwn(quantities, id) ? quantities[id] : 0
}

function isLineQuantity(quantity: unknown): quantity is number {
  return typeof quantity === 'number' && Number.isInteger(quantity) && quantity >= 1 && quantity <= MAX_LINE_QUANTITY
}

function isCategory(value: unknown): value is Category {
  return categories.some((category) => category.id === value)
}

function isTag(value: unknown): value is Tag {
  return tags.some((tag) => tag === value)
}

/** A non-blank string, trimmed. */
function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
}

// ["medium", "large"] → "medium or large"; three or more get commas.
function orList(words: string[]): string {
  return words.length <= 2 ? words.join(' or ') : `${words.slice(0, -1).join(', ')} or ${words.at(-1)}`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
