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
//   directly. So a handler reads the cart once, checks the arguments, works
//   out the cart after its change with applyCartChange (cartSummary.ts, which
//   tap updates use too), makes the change, and summarizes the cart it worked
//   out. handlers.test.ts checks that this always matches what the store holds.
//   Several calls can run before the next render; see `currentCart` below.

import type { CartDetails } from 'use-shopping-cart/core'
import type { CheckoutResult } from '../checkout/checkout'
import { categories, findVariant, formatPrice, menu, tags, type Category, type Product, type Tag } from '../menu/menu'
import { isLineQuantity, MAX_LINE_QUANTITY } from '../shop'
import {
  applyCartChange,
  describeLine,
  quantitiesOf,
  summarizeCart,
  type CartSummary,
  type ItemQuantity,
  type Quantities,
} from './cartSummary'
import { closeMatches, searchMenu, type MenuFilters } from './menuSearch'
import { planGroupOrder, type GroupOrderRequest } from './planGroupOrder'
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
  showSuggestions(suggestions: Suggestions): void
  /** Closes the suggestion card, if one is open. */
  closeSuggestions(): void
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
  /**
   * Starts checkout for the cart. It never rejects: a failed request comes back
   * as `{ message }`. In the app it's `startCheckout`, which guarantees that.
   */
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

/**
 * What plan_group_order returns once the plan is on the card: enough for the
 * agent to sum it up in a sentence and to change it with show_suggestions.
 */
export type PlanShown = {
  shown: true
  /** "8 large pizzas, 3 of them vegetarian, plus garlic knots and a drink each" */
  summary: string
  /** What the whole plan costs. */
  total: string
  lines: Array<{ id: string; name: string; quantity: number }>
}

export type ToolResult =
  | CartSummary
  | Recovery
  | FoundItems
  | { shown: true; total: string }
  | PlanShown
  | { ok: true }

/**
 * Runs one tool. Takes the arguments the agent sent, as an object or as the
 * JSON string Deepgram delivers, and never rejects.
 */
export type ToolHandler = (args: unknown) => Promise<ToolResult>

/** One handler per tool, keyed by tool name. */
export type ToolHandlers = Record<ToolName, ToolHandler>

const BAD_QUANTITY = `The quantity has to be a whole number from 1 to ${MAX_LINE_QUANTITY}.`
const EMPTY_CART = 'The cart is empty.'

/** Creates the handlers. A page makes one set and shares it, since the set remembers what it did. */
export function createToolHandlers({ cart, ui, checkout }: ToolPorts): ToolHandlers {
  // The drawer opens on its own the first time a voice change adds an item, so
  // the customer sees it happen. After that it's theirs to open and close.
  let drawerOpened = false
  function openDrawerOnce() {
    if (drawerOpened) return
    drawerOpened = true
    ui.openCart()
  }

  // Deepgram can send several function calls in one request, and they can all
  // run before React re-renders, while cart.cartDetails() still returns the
  // cart from before the first of them. So the handlers remember the cart their
  // last change worked out, with the cartDetails() object it was based on.
  // While cartDetails() returns that same object, nothing has rendered since,
  // so the remembered cart is the current one. Once it returns a new object,
  // React has rendered (the change, or a tap), and cartDetails() is trusted again.
  let lastChange: { basedOn: CartDetails; cartAfter: Quantities } | null = null

  /** The cart now, counting changes the last render doesn't show yet. */
  function currentCart(): Quantities {
    const rendered = cart.cartDetails()
    return lastChange?.basedOn === rendered ? lastChange.cartAfter : quantitiesOf(rendered)
  }

  /** Call once a cart action has run: remembers the cart after it, and returns its summary. */
  function changed(cartAfter: Quantities): CartSummary {
    lastChange = { basedOn: cart.cartDetails(), cartAfter }
    return summarizeCart(cartAfter)
  }

  // The lines on the suggestion card shown last. When add_items adds exactly
  // those ("add all of that"), the card closes, as it does after its own Add
  // all, so tapping Add all can't add the whole set a second time.
  let suggested: ItemQuantity[] | null = null

  /** Opens the suggestion card with these lines: show_suggestions and plan_group_order both use it. */
  function suggest(title: unknown, reason: unknown, items: unknown): Suggestions | Recovery {
    // Not checked against the cart: it can change before the customer taps
    // Add all, and Add all checks again then.
    const checked = checkLines(items, {})
    if ('message' in checked) return { message: `Nothing was shown. ${checked.message}` }
    // Priced as a cart holding only these lines, so summarizeCart is the one place that prices lines.
    const { lines, total } = summarizeCart(applyCartChange({}, { type: 'add', lines: checked.lines }))
    const reasonText = nonBlankText(reason)
    const suggestions = { title: nonBlankText(title) ?? 'Suggestions', ...(reasonText ? { reason: reasonText } : {}), lines, total }
    ui.showSuggestions(suggestions)
    suggested = checked.lines
    return suggestions
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
      const shown = suggest(args.title, args.reason, args.items)
      return 'message' in shown ? shown : { shown: true, total: shown.total }
    }),

    // The code works out the plan (planGroupOrder.ts) and the card shows it, as
    // show_suggestions would; the agent only sums it up. It doesn't change the cart.
    plan_group_order: recovering((args) => {
      // A cast, not a check: planGroupOrder checks every field at run time, since the agent can send anything.
      const plan = planGroupOrder(args as GroupOrderRequest)
      if ('message' in plan) return { message: `Nothing was shown. ${plan.message}` }
      const shown = suggest(plan.title, plan.reason, plan.lines)
      if ('message' in shown) return shown
      const lines = shown.lines.map(({ id, name, quantity }) => ({ id, name, quantity }))
      return { shown: true, summary: plan.summary, total: shown.total, lines }
    }),

    add_item: recovering((args) => {
      const inCart = currentCart()
      const line = checkLine(args.id, args.quantity, inCart)
      if ('message' in line) return line
      const cartAfter = applyCartChange(inCart, { type: 'add', lines: [line] })
      cart.addItem(line.product, { count: line.quantity })
      openDrawerOnce()
      return changed(cartAfter)
    }),

    add_items: recovering((args) => {
      const added = addLines(cart, currentCart(), args.items)
      if ('message' in added) return added
      openDrawerOnce()
      if (suggested && sameLines(added.lines, suggested)) {
        suggested = null
        ui.closeSuggestions()
      }
      return changed(added.cartAfter)
    }),

    set_quantity: recovering(({ id, quantity }) => {
      const inCart = currentCart()
      if (!isInCart(inCart, id)) return notInCart(id, inCart)
      if (!isLineQuantity(quantity)) return { message: `${BAD_QUANTITY} To take it out of the cart, use remove_item.` }
      const cartAfter = applyCartChange(inCart, { type: 'quantity', id, quantity })
      cart.setItemQuantity(id, quantity)
      return changed(cartAfter)
    }),

    remove_item: recovering(({ id }) => {
      const inCart = currentCart()
      if (!isInCart(inCart, id)) return notInCart(id, inCart)
      const cartAfter = applyCartChange(inCart, { type: 'remove', id })
      cart.removeItem(id)
      return changed(cartAfter)
    }),

    view_cart: recovering(() => summarizeCart(currentCart())),

    clear_cart: recovering(() => {
      const cartAfter = applyCartChange(currentCart(), { type: 'clear' })
      cart.clearCart()
      return changed(cartAfter)
    }),

    checkout: recovering(async () => {
      // The rendered cart, not currentCart(): checkout needs full cart entries. The agent
      // checks out only once the customer confirms the order, a turn after any change.
      const cartDetails = cart.cartDetails()
      if (Object.keys(cartDetails).length === 0) return { message: EMPTY_CART }
      const result = await checkout(cartDetails)
      if ('message' in result) return result
      ui.goToCheckout(result.url)
      return { ok: true }
    }),
  }
}

/**
 * Adds every line or none, to a cart that holds `inCart`. All lines are checked
 * first (on the menu, a size given, a good quantity, and at most
 * `MAX_LINE_QUANTITY` per line counting what's in the cart), and lines with the
 * same id are added up. Returns the lines added and the cart after. add_items
 * uses it, and so does the suggestion card's Add all, so both behave the same.
 */
export function addLines(
  cart: Pick<CartPort, 'addItem'>,
  inCart: Quantities,
  items: unknown,
): { lines: ItemQuantity[]; cartAfter: Quantities } | Recovery {
  const checked = checkLines(items, inCart)
  if ('message' in checked) return { message: `Nothing was added. ${checked.message}` }
  const cartAfter = applyCartChange(inCart, { type: 'add', lines: checked.lines })
  for (const line of checked.lines) cart.addItem(line.product, { count: line.quantity })
  return { lines: checked.lines.map(({ id, quantity }) => ({ id, quantity })), cartAfter }
}

/** A line that passed the checks, with its product from the menu. */
type CheckedLine = ItemQuantity & { product: Product }

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
    merged.set(line.id, { ...line, quantity: earlier + line.quantity })
  }
  return { lines: [...merged.values()] }
}

/** Checks one line to add. `earlier` is how many of the same id earlier lines in this call add. */
function checkLine(id: unknown, quantity: unknown, inCart: Quantities, earlier = 0): CheckedLine | Recovery {
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
  return { id: product.id, quantity, product }
}

/** The product with this id, or why there's none: no id, no size, or not on the menu. */
function findOnMenu(id: unknown): Product | Recovery {
  if (typeof id !== 'string' || id === '') return { message: "The id is missing. Send the item's id from the menu." }
  return findVariant(id)?.product ?? notOnMenu(id)
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

function quantityOf(quantities: Quantities, id: string): number {
  return Object.hasOwn(quantities, id) ? quantities[id] : 0
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

// ["medium", "large"] → "medium or large"; three or more get commas.
function orList(words: string[]): string {
  return words.length <= 2 ? words.join(' or ') : `${words.slice(0, -1).join(', ')} or ${words.at(-1)}`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
