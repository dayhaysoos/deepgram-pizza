// What each tool does when the agent calls it. The handlers run in the browser
// and reach the cart, the screen and checkout only through the ports passed to
// createToolHandlers, so tests can run them with a plain cart and fakes.
//
// Two rules shape this file (AGENTS.md, "Architecture"):
// - Tools recover; they don't throw. The agent can send anything, so every
//   argument is checked, and a problem comes back as `{ message }`: a short
//   sentence the agent can act on. A thrown error would end its turn in silence.
// - Every cart tool returns the cart summary. A handler checks its arguments
//   against the cart now (`cart.now()`), then makes the change through the
//   cart port (`cart.change()`), which returns the summary of the cart after
//   it, even before React renders it. In the app the port is the page's cart
//   changes (cartChanges.ts), which taps go through too.

import type { CartDetails } from 'use-shopping-cart/core'
import type { CheckoutResult } from '../checkout/checkout'
import { isRecord } from '../isRecord'
import { categories, findItem, findVariant, formatPrice, tags, type Category, type Product, type Tag } from '../menu/menu'
import { isLineQuantity, isOrderType, MAX_LINE_QUANTITY, ORDER_TYPES, type OrderType } from '../shop'
import type { CartChanges } from './cartChanges'
import {
  applyCartChange,
  describeLine,
  quantityOf,
  summarizeCart,
  type CartSummary,
  type ItemQuantity,
  type Quantities,
} from './cartSummary'
import { closeMatches, searchMenu, type MenuFilters } from './menuSearch'
import type { OrderTypeStore } from './orderType'
import { planGroupOrder } from './planGroupOrder'
import { orList, type Recovery } from './text'
import { MAX_LINES_PER_CALL, type ToolName } from './tools'

/**
 * The cart: `now()` to check a call against, `change()` to make a change and
 * get the summary of the cart after it, and `cartDetails()` for checkout. In
 * the app it's the page's cart changes (cartChanges.ts).
 */
export type CartPort = Pick<CartChanges, 'now' | 'change' | 'cartDetails'>

/** What the tools change on screen. */
export type UiPort = {
  /** Lights up these menu cards, by item id. An empty list clears the highlights. */
  highlight(itemIds: string[]): void
  /** Opens the suggestion card, replacing any card already open. */
  showSuggestions(suggestions: Suggestions): void
  /** Closes the suggestion card, if one is open. */
  closeSuggestions(): void
  /** Whether a suggestion card is open now: the customer can close it with ✕. */
  isShowingSuggestions(): boolean
  openCart(): void
  /** Leaves for Stripe Checkout, once the agent has finished speaking. */
  goToCheckout(url: string): void
}

/** What the suggestion card shows: the lines show_suggestions was given, priced as a cart of their own. */
export type Suggestions = {
  title: string
  reason?: string
  lines: CartSummary['lines']
  /** What every line together costs. */
  total: string
}

export type ToolPorts = {
  cart: CartPort
  ui: UiPort
  /** Pickup or delivery: set_order_type records it, and checkout needs it. In the app it's the page's store (orderType.ts). */
  orderType: Pick<OrderTypeStore, 'get' | 'set'>
  /**
   * Starts checkout for the cart, for pickup or delivery. It never rejects: a
   * failed request comes back as `{ message }`. In the app it's
   * `startCheckout`, which guarantees that.
   */
  checkout(cartDetails: CartDetails, orderType: OrderType): Promise<CheckoutResult>
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

/** What show_suggestions returns once the card is open: what every line together costs, written and spoken. */
export type SuggestionsShown = { shown: true } & Pick<CartSummary, 'total' | 'totalSpoken'>

/**
 * What plan_group_order returns once the plan is on the card: enough for the
 * agent to sum it up in a sentence and to change it with show_suggestions.
 */
export type PlanShown = SuggestionsShown & {
  /** "8 large pizzas, 3 of them vegetarian, plus garlic knots and a drink each" */
  summary: string
  lines: Array<{ id: string; name: string; quantity: number }>
}

/** What set_order_type returns once it has recorded the choice. */
export type OrderTypeSet = { orderType: OrderType }

export type ToolResult = CartSummary | Recovery | FoundItems | SuggestionsShown | PlanShown | OrderTypeSet | { ok: true }

/**
 * Runs one tool. Takes the arguments the agent sent, as an object or as the
 * JSON string Deepgram delivers, and never rejects.
 */
export type ToolHandler = (args: unknown) => Promise<ToolResult>

/** One handler per tool, keyed by tool name. */
export type ToolHandlers = Record<ToolName, ToolHandler>

const BAD_QUANTITY = `The quantity has to be a whole number from 1 to ${MAX_LINE_QUANTITY}.`
const EMPTY_CART = 'The cart is empty.'
const ASK_ORDER_TYPE = "Ask whether it's pickup or delivery first."
const BAD_ORDER_TYPE = `The type has to be ${orList(ORDER_TYPES.map((type) => `"${type}"`))}. Ask which, if the customer hasn't said.`

/** Creates the handlers. A page makes one set and shares it, since the set remembers what it did. */
export function createToolHandlers({ cart, ui, orderType, checkout }: ToolPorts): ToolHandlers {
  // The drawer opens on its own the first time a voice change adds an item, so
  // the customer sees it happen. After that it's theirs to open and close.
  let drawerOpened = false
  function openDrawerOnce() {
    if (drawerOpened) return
    drawerOpened = true
    ui.openCart()
  }

  // The lines on the suggestion card shown last. When add_items adds exactly
  // those ("add all of that"), the card closes, as it does after its own Add
  // all, so tapping Add all can't add the whole set a second time.
  let suggested: ItemQuantity[] | null = null
  // The lines plan_group_order put on the card, while they're the card shown
  // last. The agent sometimes shows them again with show_suggestions, under a
  // title of its own and with no reason (it never sees the card's); while that
  // card is still up, the repeat leaves it as it is, reason and all. Any other
  // set replaces the card, as SPEC's Screens says.
  let planned: ItemQuantity[] | null = null

  /**
   * Opens the suggestion card with these lines: show_suggestions and
   * plan_group_order both use it. Returns what the card shows, plus the total
   * spoken, for the agent.
   */
  function suggest(
    title: unknown,
    reason: unknown,
    items: unknown,
    from: 'show_suggestions' | 'plan_group_order',
  ): (Suggestions & Pick<CartSummary, 'totalSpoken'>) | Recovery {
    // Not checked against the cart: it can change before the customer taps
    // Add all, and Add all checks again then.
    const checked = checkLines(items, {})
    if ('message' in checked) return { message: `Nothing was shown. ${checked.message}` }
    // Priced as a cart holding only these lines, so summarizeCart is the one place that prices lines.
    const { lines, total, totalSpoken } = summarizeCart(applyCartChange({}, { type: 'add', lines: checked.lines }))
    const reasonText = nonBlankText(reason)
    const suggestions = { title: nonBlankText(title) ?? 'Suggestions', ...(reasonText ? { reason: reasonText } : {}), lines, total }
    const repeatsPlan = from === 'show_suggestions' && planned && ui.isShowingSuggestions() && sameLines(checked.lines, planned)
    if (!repeatsPlan) {
      ui.showSuggestions(suggestions)
      suggested = checked.lines
      planned = from === 'plan_group_order' ? checked.lines : null
    }
    return { ...suggestions, totalSpoken }
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
      const shown = suggest(args.title, args.reason, args.items, 'show_suggestions')
      return 'message' in shown ? shown : { shown: true, total: shown.total, totalSpoken: shown.totalSpoken }
    }),

    // The code works out the plan (planGroupOrder.ts) and the card shows it, as
    // show_suggestions would; the agent only sums it up. It doesn't change the
    // cart, but it leaves room for what's in it, so "add all of that" fits.
    plan_group_order: recovering((args) => {
      const plan = planGroupOrder(args, cart.now())
      if ('message' in plan) return { message: `Nothing was shown. ${plan.message}` }
      const shown = suggest(plan.title, plan.reason, plan.lines, 'plan_group_order')
      if ('message' in shown) return shown
      const lines = shown.lines.map(({ id, name, quantity }) => ({ id, name, quantity }))
      return { shown: true, summary: plan.summary, total: shown.total, totalSpoken: shown.totalSpoken, lines }
    }),

    add_item: recovering((args) => {
      const line = checkLine(args.id, args.quantity, cart.now())
      if ('message' in line) return line
      const cartAfter = cart.change({ type: 'add', lines: [line] })
      openDrawerOnce()
      return cartAfter
    }),

    add_items: recovering((args) => {
      const checked = checkLinesToAdd(args.items, cart.now())
      if ('message' in checked) return checked
      const cartAfter = cart.change({ type: 'add', lines: checked.lines })
      openDrawerOnce()
      if (suggested && sameLines(checked.lines, suggested)) {
        suggested = null
        planned = null
        ui.closeSuggestions()
      }
      return cartAfter
    }),

    set_quantity: recovering(({ id, quantity }) => {
      const inCart = cart.now()
      if (!isInCart(inCart, id)) return notInCart(id, inCart)
      if (!isLineQuantity(quantity)) return { message: `${BAD_QUANTITY} To take it out of the cart, use remove_item.` }
      return cart.change({ type: 'quantity', id, quantity })
    }),

    remove_item: recovering(({ id }) => {
      const inCart = cart.now()
      if (!isInCart(inCart, id)) return notInCart(id, inCart)
      return cart.change({ type: 'remove', id })
    }),

    view_cart: recovering(() => summarizeCart(cart.now())),

    clear_cart: recovering(() => cart.change({ type: 'clear' })),

    // Not a cart tool, so it returns the choice, not the cart: with the cart
    // and its total, the agent would read them back after "delivery".
    set_order_type: recovering(({ type }) => {
      if (!isOrderType(type)) return { message: BAD_ORDER_TYPE }
      orderType.set(type)
      return { orderType: type }
    }),

    checkout: recovering(async () => {
      // The rendered cart, not cart.now(): checkout needs full cart entries. The agent
      // checks out only once the customer confirms the order, a turn after any change.
      const cartDetails = cart.cartDetails()
      if (Object.keys(cartDetails).length === 0) return { message: EMPTY_CART }
      const type = orderType.get()
      if (type === null) return { message: ASK_ORDER_TYPE }
      const result = await checkout(cartDetails, type)
      if ('message' in result) return result
      ui.goToCheckout(result.url)
      return { ok: true }
    }),
  }
}

/**
 * Checks lines to add to a cart that holds `inCart`, all or none: each on the
 * menu with a size given, a good quantity, and at most `MAX_LINE_QUANTITY` per
 * line counting what's in the cart. Lines with the same id are added up.
 * Returns the lines to add, or why none can be. add_items uses it, and so do
 * the suggestion card's Add and Add all, so both behave the same.
 */
export function checkLinesToAdd(items: unknown, inCart: Quantities): { lines: ItemQuantity[] } | Recovery {
  const checked = checkLines(items, inCart)
  return 'message' in checked ? { message: `Nothing was added. ${checked.message}` } : checked
}

/** Checks a list of lines to add, merging repeated ids. A problem names its line. */
function checkLines(items: unknown, inCart: Quantities): { lines: ItemQuantity[] } | Recovery {
  if (!Array.isArray(items) || items.length === 0) {
    return { message: 'Send items as a list of lines, each with an id and a quantity.' }
  }
  if (items.length > MAX_LINES_PER_CALL) {
    return { message: `That's ${items.length} lines, and one call takes at most ${MAX_LINES_PER_CALL}.` }
  }
  const merged = new Map<string, ItemQuantity>()
  for (const [index, item] of items.entries()) {
    const { id, quantity }: Record<string, unknown> = isRecord(item) ? item : {}
    const earlier = typeof id === 'string' ? (merged.get(id)?.quantity ?? 0) : 0
    const line = checkLine(id, quantity, inCart, earlier)
    if ('message' in line) {
      const label = typeof id === 'string' ? `Line ${index + 1} (${JSON.stringify(id)})` : `Line ${index + 1}`
      return { message: `${label}: ${line.message}` }
    }
    merged.set(line.id, { id: line.id, quantity: earlier + line.quantity })
  }
  return { lines: [...merged.values()] }
}

/** Checks one line to add. `earlier` is how many of the same id earlier lines in this call add. */
function checkLine(id: unknown, quantity: unknown, inCart: Quantities, earlier = 0): ItemQuantity | Recovery {
  const product = findOnMenu(id)
  if ('message' in product) return product
  if (!isLineQuantity(quantity)) return { message: BAD_QUANTITY }
  const already = quantityOf(inCart, product.id)
  const total = already + earlier + quantity
  if (total > MAX_LINE_QUANTITY) {
    const now = already > 0 ? ` There are ${already} in the cart now.` : ''
    const line = describeLine({ name: product.name, quantity: total })
    return { message: `That would make ${line}, and a line holds at most ${MAX_LINE_QUANTITY}.${now}` }
  }
  return { id: product.id, quantity }
}

/** The product with this id, or why there's none: no id, no size, or not on the menu. */
function findOnMenu(id: unknown): Product | Recovery {
  if (typeof id !== 'string' || id === '') return { message: "The id is missing. Send the item's id from the menu." }
  return findVariant(id)?.product ?? notOnMenu(id)
}

function notOnMenu(id: string): Recovery {
  // A sized item's id without the size, such as "pepperoni-pizza".
  const item = findItem(id)
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

/**
 * For set_quantity and remove_item, when the id isn't in the cart: what's wrong
 * with an id that isn't on the menu, or else the cart's lines with their ids.
 */
function notInCart(id: unknown, quantities: Quantities): Recovery {
  const product = findOnMenu(id)
  if ('message' in product) return product
  const { lines } = summarizeCart(quantities)
  if (lines.length === 0) return { message: `That isn't in the cart. ${EMPTY_CART}` }
  const listed = lines.map((line) => `${describeLine(line)} (${line.id})`).join(', ')
  return { message: `That isn't in the cart. The cart has: ${listed}.` }
}

/** Whether two lists of lines, one line per id, hold the same ids and quantities, in any order. */
function sameLines(a: ItemQuantity[], b: ItemQuantity[]): boolean {
  return (
    a.length === b.length && a.every((line) => b.some((other) => other.id === line.id && other.quantity === line.quantity))
  )
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
  const query = nonBlankText(args.query)
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

// Object.hasOwn, so an id like "constructor" isn't found on Object.prototype.
function isInCart(quantities: Quantities, id: unknown): id is string {
  return typeof id === 'string' && Object.hasOwn(quantities, id)
}

function isCategory(value: unknown): value is Category {
  return categories.some((category) => category.id === value)
}

function isTag(value: unknown): value is Tag {
  return tags.some((tag) => tag === value)
}

/** The value trimmed, if it's a string that isn't blank. */
function nonBlankText(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
}
