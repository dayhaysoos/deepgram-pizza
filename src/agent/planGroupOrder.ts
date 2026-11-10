// Plans food for a group from menu.json: which mains, sides and drinks, and
// how many of each. The plan_group_order tool (handlers.ts) shows it on the
// suggestion card. The code does the math so the agent only has to talk: in
// the owner's run, asked for "a party of thirty, ten of them vegetarian", the
// LLM worked it out itself and proposed about twice the food.
//
// The rules, accepted by the owner (SPEC.md, Decisions). To change them, edit
// the constants below; planGroupOrder.test.ts pins the plans they give.
// - Mains: about one serving per person, from each size's `serves`. Large
//   sizes, rounded up; if that's more than MAX_OVER over, one large becomes
//   the smaller size (30 people: 8 larges feed 32, 7% over, so they stay).
// - Vegetarians eat from vegetarian-tagged mains, planned first (10: 3 larges).
// - Kinds: up to two per group (the vegetarians, everyone else), four in all,
//   more only if they asked for more or 20 to a line needs more. Popular items
//   first, what they asked for always, a spicy one when someone likes it
//   spicy, and nothing spicy otherwise.
// - In a mix, large pizzas cover about half and subs make up the rest.
// - One shareable side per PEOPLE_PER_SIDE people, from what the mains pair with.
// - One drink per person, unless they don't want drinks.
// - A plan never breaks the cart's limits (MAX_LINE_QUANTITY a line,
//   MAX_LINES_PER_CALL lines). A group too big for one order gets a message
//   with the largest group that fits.
//
// Like tools.ts, this module imports nothing from React or the server, so
// evals can load it on its own.

import { categories, defaultVariant, findVariant, menu, products, type Category, type MenuItem, type Variant } from '../menu/menu'
import { MAX_LINE_QUANTITY } from '../shop'
import type { ItemQuantity } from './cartSummary'
import { GROUP_MAINS, MAX_LINES_PER_CALL, type GroupMains } from './tools'

/** Mains may feed this share more than the group, when the sizes allow. */
const MAX_OVER = 0.1
/** One side per this many people, rounded up. */
const PEOPLE_PER_SIDE = 5
/** The most kinds of mains in a plan, unless they asked for more by name. */
const MAX_KINDS = 4
/** The most kinds of mains for one group (the vegetarians, or everyone else) in one category. */
const MAX_KINDS_PER_GROUP = 2
/** The most kinds of sides picked from what the mains pair with. */
const MAX_SIDE_KINDS = 2
/** In a mix, the share of servings the first category (pizza) covers, in whole large sizes. */
const MIX_SHARE = 0.5

/** The categories each choice of mains plans from. In a mix, the last one makes up the rest. */
const MAINS_CATEGORIES = {
  pizza: ['pizza'],
  subs: ['subs'],
  mix: ['pizza', 'subs'],
} as const satisfies Record<GroupMains, readonly Category[]>

/** How the summary counts each category's mains. */
const MAIN_NOUNS: Record<MainCategory, [one: string, many: string]> = {
  pizza: ['pizza', 'pizzas'],
  subs: ['sub', 'subs'],
}

const SIDES = 'sides' satisfies Category
const DRINKS = 'drinks' satisfies Category

type MainCategory = (typeof MAINS_CATEGORIES)[GroupMains][number]
const MAIN_CATEGORIES: MainCategory[] = ['pizza', 'subs']
const PLANNED_CATEGORIES: Category[] = [...MAIN_CATEGORIES, SIDES, DRINKS]

/** What plan_group_order takes: who's eating, and what they said they like. */
export type GroupOrderRequest = {
  /** How many people are eating. */
  people: number
  /** How many of them are vegetarian. None when left out. */
  vegetarians?: number
  preferences?: GroupPreferences
}

/** Only what the customer said. Everything is optional. */
export type GroupPreferences = {
  /** Pizza (the default), subs, or a mix of both. */
  mains?: GroupMains
  /** Someone likes it spicy: one kind of mains is spicy. Without it, nothing spicy. */
  spicy?: boolean
  /** False when they don't want drinks. */
  drinks?: boolean
  /** Items they asked for by name, by item id ("white-pizza"). A variant id counts as its item. */
  include?: string[]
}

export type GroupPlan = {
  /** "Party of 30": the card's heading. */
  title: string
  /** "Mains for 32 (12 vegetarian), sides to share and a drink each.": the card's line under it. */
  reason: string
  /** "8 large pizzas, 3 of them vegetarian, plus garlic knots and a drink each": for the agent to say in its own words. */
  summary: string
  /** Variant ids and quantities, in menu order. */
  lines: ItemQuantity[]
}

type Recovery = { message: string }

/**
 * The plan for a group, or a short message the agent can act on. It never
 * throws, and checks every field at run time, since the agent can send anything.
 * The same request always gets the same plan.
 */
export function planGroupOrder(request: GroupOrderRequest): GroupPlan | Recovery {
  const read = readRequest(request)
  if ('message' in read) return read
  const plan = buildPlan(read)
  if (plan) return plan

  // Too big for one order: find the largest group that fits, keeping everything else.
  const fits = (people: number) =>
    buildPlan({ ...read, people, vegetarians: Math.min(read.vegetarians, people) }) !== undefined
  if (!fits(1)) return { message: "Nothing on the menu fits that plan. Try other preferences." }
  let most = 1
  let tooMany = read.people
  while (tooMany - most > 1) {
    const middle = Math.floor((most + tooMany) / 2)
    if (fits(middle)) most = middle
    else tooMany = middle
  }
  const withoutDrinks = read.drinks && buildPlan({ ...read, drinks: false }) !== undefined
  return {
    message:
      `That's more than one order holds (at most ${MAX_LINE_QUANTITY} of each item), so a plan can feed up to ${most} ${most === 1 ? 'person' : 'people'} at a time.` +
      (withoutDrinks ? ` Without drinks, all ${read.people} fit.` : ''),
  }
}

/** A request that passed the checks, with its defaults filled in. */
type Request = {
  people: number
  vegetarians: number
  /** The main categories to plan from, in MAIN_CATEGORIES order. */
  mains: MainCategory[]
  spicy: boolean
  drinks: boolean
  include: MenuItem[]
}

function readRequest(request: GroupOrderRequest): Request | Recovery {
  const people: unknown = request.people
  if (!isWholeNumber(people) || people < 1) {
    return { message: 'people has to be how many are eating: a whole number, 1 or more.' }
  }
  const vegetarians: unknown = request.vegetarians ?? 0
  if (!isWholeNumber(vegetarians) || vegetarians < 0) return { message: 'vegetarians has to be a whole number, 0 or more.' }
  if (vegetarians > people) {
    return {
      message: `That's ${vegetarians} vegetarians in a group of ${people}. Ask how many people in all, and how many of them are vegetarian.`,
    }
  }

  const preferences: unknown = request.preferences ?? {}
  if (!isRecord(preferences)) return { message: 'preferences has to be an object, such as { "spicy": true }.' }
  const mains: unknown = preferences.mains ?? 'pizza'
  if (!isGroupMains(mains)) return { message: `mains has to be ${orList([...GROUP_MAINS])}.` }
  const spicy: unknown = preferences.spicy ?? false
  if (typeof spicy !== 'boolean') return { message: 'spicy has to be true or false.' }
  const drinks: unknown = preferences.drinks ?? true
  if (typeof drinks !== 'boolean') return { message: 'drinks has to be true or false.' }

  const ids: unknown = preferences.include ?? []
  if (!Array.isArray(ids)) return { message: 'include has to be a list of item ids, such as ["white-pizza"].' }
  const include: MenuItem[] = []
  for (const id of ids) {
    const item = typeof id === 'string' ? itemFor(id) : undefined
    if (!item) return { message: `There's no ${JSON.stringify(id)} on the menu. include takes item ids, such as "white-pizza".` }
    if (!PLANNED_CATEGORIES.includes(item.category)) {
      const planned = andList(PLANNED_CATEGORIES.map((category) => labelOf(category).toLowerCase()))
      return {
        message: `plan_group_order plans ${planned}, not ${item.name}. Plan without it, then add it to the card with show_suggestions.`,
      }
    }
    if (!include.includes(item)) include.push(item)
  }

  // A main asked for by name brings its category in: pizza plus a named sub is a mix.
  const chosen: readonly Category[] = MAINS_CATEGORIES[mains]
  return {
    people,
    vegetarians,
    mains: MAIN_CATEGORIES.filter((category) => chosen.includes(category) || include.some((item) => item.category === category)),
    spicy,
    drinks: drinks || include.some((item) => item.category === DRINKS),
    include,
  }
}

/** The mains for one group (the vegetarians, or everyone else) from one category. */
type Slot = {
  category: MainCategory
  vegetarian: boolean
  /** How many the category's large and small sizes serve. They're the same for subs. */
  big: number
  small: number
  bigCount: number
  /** 0, or 1 when a large became the small size. */
  smallCount: number
}

/** The plan, or undefined when it doesn't fit in one order. */
function buildPlan(request: Request): GroupPlan | undefined {
  const { people, vegetarians } = request

  // 1. How many of each size: the vegetarians first, then everyone else.
  const vegetarianSlots = slotsFor(request, true, vegetarians)
  const otherSlots = slotsFor(request, false, Math.max(0, people - servingsOf(vegetarianSlots)))
  const over = servingsOf([...vegetarianSlots, ...otherSlots]) - people
  if (over > people * MAX_OVER) {
    // One large becomes the small size, where it still feeds everyone (and every vegetarian).
    const swap = [...otherSlots, ...vegetarianSlots].find(
      (slot) =>
        slot.bigCount > 0 &&
        slot.small < slot.big &&
        over >= slot.big - slot.small &&
        (!slot.vegetarian || servingsOf(vegetarianSlots) - (slot.big - slot.small) >= vegetarians),
    )
    if (swap) {
      swap.bigCount--
      swap.smallCount++
    }
  }

  // 2. Which kinds, and how many of each.
  const slots = [...vegetarianSlots, ...otherSlots].filter((slot) => slot.bigCount + slot.smallCount > 0)
  const kindsEach = Math.min(MAX_KINDS_PER_GROUP, Math.max(1, Math.floor(MAX_KINDS / slots.length)))
  const spicy = request.spicy ? spicyPick(slots) : undefined
  const used = new Set<MenuItem>()
  const lines: ItemQuantity[] = []
  const mains: Array<{ item: MenuItem; count: number }> = []
  for (const slot of slots) {
    const count = slot.bigCount + slot.smallCount
    const pool = poolFor(slot, request, used)
    const asked = request.include.filter((item) => slotFor(item, slots) === slot)
    const must = unique([...asked, ...(spicy?.slot === slot ? [spicy.item] : [])]).filter((item) => pool.includes(item))
    // As many kinds as the slot likes, if the menu has them; as many as 20 to a line needs, or no plan.
    const needed = Math.ceil(count / MAX_LINE_QUANTITY)
    const kinds = unique([...must, ...pool])
      .slice(0, Math.max(Math.min(count, Math.max(kindsEach, must.length)), needed))
      .sort((a, b) => pool.indexOf(a) - pool.indexOf(b))
    if (kinds.length < needed) return undefined

    const counts = spread(count, kinds.length)
    kinds.forEach((item, index) => {
      used.add(item)
      mains.push({ item, count: counts[index] })
      // The small size, if any, goes to the last kind.
      const small = index === kinds.length - 1 ? slot.smallCount : 0
      if (counts[index] > small) lines.push({ id: sizeOf(item, slot.big).id, quantity: counts[index] - small })
      if (small > 0) lines.push({ id: sizeOf(item, slot.small).id, quantity: small })
    })
  }

  // 3. Sides and drinks, from what the mains pair with, the mains with the most first.
  const pairs = [...mains]
    .sort((a, b) => b.count - a.count || menu.indexOf(a.item) - menu.indexOf(b.item))
    .flatMap(({ item }) => item.pairsWith)
  const sideCount = Math.ceil(people / PEOPLE_PER_SIDE)
  const sides = extras(SIDES, sideCount, MAX_SIDE_KINDS, pairs, request)
  const drinks = request.drinks ? extras(DRINKS, people, 1, pairs, request) : []
  if (!sides || !drinks) return undefined
  lines.push(...sides, ...drinks)

  if (lines.length > MAX_LINES_PER_CALL || lines.some((line) => line.quantity > MAX_LINE_QUANTITY)) return undefined
  lines.sort((a, b) => MENU_ORDER.indexOf(a.id) - MENU_ORDER.indexOf(b.id))
  return { title: `Party of ${people}`, ...describePlan(lines, request, sideCount), lines }
}

/** Every variant id, in menu order: the order a plan's lines are listed in. */
const MENU_ORDER = products.map((product) => product.id)

/** The slots one group needs to be fed `servings`, one per main category. */
function slotsFor(request: Request, vegetarian: boolean, servings: number): Slot[] {
  if (servings === 0) return []
  let left = servings
  return request.mains.map((category, index) => {
    const { big, small } = sizesOf(category)
    // In a mix, the first category takes its share in whole large sizes; the last makes up the rest.
    const bigCount = index === request.mains.length - 1 ? Math.ceil(left / big) : Math.round((servings * MIX_SHARE) / big)
    left = Math.max(0, left - bigCount * big)
    return { category, vegetarian, big, small, bigCount, smallCount: 0 }
  })
}

function servingsOf(slots: Slot[]): number {
  return slots.reduce((sum, slot) => sum + slot.bigCount * slot.big + slot.smallCount * slot.small, 0)
}

/**
 * How many a category's largest and smallest sizes serve. The planner assumes
 * a category's items share their sizes, as every pizza is Medium for 2 and
 * Large for 4; planGroupOrder.test.ts checks menu.json keeps to that.
 */
export function sizesOf(category: Category): { big: number; small: number } {
  const serves = menu.find((item) => item.category === category)?.variants.map((variant) => variant.serves) ?? [1]
  return { big: Math.max(...serves), small: Math.min(...serves) }
}

/** The item's size that serves this many, or its largest. */
function sizeOf(item: MenuItem, serves: number): Variant {
  return item.variants.find((variant) => variant.serves === serves) ?? defaultVariant(item)
}

/**
 * What a slot can pick from, best first: popular items, then the rest, and for
 * everyone else, items with meat before vegetarian ones, since the vegetarians
 * have their own. Spicy items only when someone likes it spicy or asked for
 * one, and nothing another slot already has. Menu order breaks ties.
 */
function poolFor(slot: Slot, request: Request, used: Set<MenuItem>): MenuItem[] {
  const rank = (item: MenuItem) => (isPopular(item) ? 0 : 2) + (isVegetarian(item) ? 1 : 0)
  return menu
    .filter(
      (item) =>
        item.category === slot.category &&
        !used.has(item) &&
        (!slot.vegetarian || isVegetarian(item)) &&
        allowed(item, request),
    )
    .sort((a, b) => rank(a) - rank(b))
}

/** The slot an asked-for main goes in: the vegetarians' if it's vegetarian and they have one, else everyone else's. */
function slotFor(item: MenuItem, slots: Slot[]): Slot | undefined {
  const inCategory = slots.filter((slot) => slot.category === item.category)
  return (isVegetarian(item) ? inCategory.find((slot) => slot.vegetarian) : undefined) ?? inCategory.find((slot) => !slot.vegetarian)
}

/** The spicy main for someone who likes it spicy: everyone else's first, then the vegetarians'. */
function spicyPick(slots: Slot[]): { slot: Slot; item: MenuItem } | undefined {
  const order = [...slots.filter((slot) => !slot.vegetarian), ...slots.filter((slot) => slot.vegetarian)]
  for (const slot of order) {
    const item = menu.find(
      (candidate) =>
        candidate.category === slot.category && isSpicy(candidate) && (!slot.vegetarian || isVegetarian(candidate)),
    )
    if (item) return { slot, item }
  }
  return undefined
}

/**
 * `count` sides or drinks, spread evenly over a few kinds: the ones asked for,
 * or else up to `pairedKinds` the mains pair with, or else the popular one.
 * Undefined when the category can't hold that many at 20 a line.
 */
function extras(category: Category, count: number, pairedKinds: number, pairs: string[], request: Request): ItemQuantity[] | undefined {
  const inCategory = (item: MenuItem | undefined): item is MenuItem =>
    item !== undefined && item.category === category && allowed(item, request)
  const asked = request.include.filter(inCategory)
  const paired = unique(pairs.map((id) => menu.find((item) => item.id === id)).filter(inCategory))
  const rest = menu.filter(inCategory).sort((a, b) => Number(isPopular(b)) - Number(isPopular(a)))
  const needed = Math.ceil(count / MAX_LINE_QUANTITY)
  const kinds = unique([...asked, ...paired, ...rest]).slice(
    0,
    Math.max(Math.min(count, Math.max(asked.length, Math.min(paired.length, pairedKinds), 1)), needed),
  )
  if (kinds.length < needed) return undefined
  const counts = spread(count, kinds.length)
  return kinds.map((item, index) => ({ id: defaultVariant(item).id, quantity: counts[index] }))
}

/** The card's reason and the agent's summary, in words. */
function describePlan(lines: ItemQuantity[], request: Request, sideCount: number): Pick<GroupPlan, 'reason' | 'summary'> {
  const found = lines.flatMap((line) => {
    const variant = findVariant(line.id)
    return variant ? [{ ...line, ...variant }] : []
  })
  const mains = found.filter(({ item }) => isMainCategory(item.category))
  const fed = mains.reduce((sum, line) => sum + line.variant.serves * line.quantity, 0)
  const vegetarianFed = mains
    .filter(({ item }) => isVegetarian(item))
    .reduce((sum, line) => sum + line.variant.serves * line.quantity, 0)
  const drink = request.people === 1 ? 'a drink' : 'a drink each'

  const mainsFor = `Mains for ${fed}${request.vegetarians > 0 ? ` (${vegetarianFed} vegetarian)` : ''}`
  const sides = sideCount === 1 ? 'a side' : 'sides to share'
  const reason = request.drinks ? `${mainsFor}, ${sides} and ${drink}.` : `${mainsFor} and ${sides}.`

  // "8 large pizzas, 3 of them vegetarian": the size only when they're all one size.
  const counted = request.mains.flatMap((category) => {
    const inCategory = mains.filter(({ item }) => item.category === category)
    const total = inCategory.reduce((sum, line) => sum + line.quantity, 0)
    if (total === 0) return []
    const labels = unique(inCategory.map(({ variant }) => variant.label))
    const size = labels.length === 1 && labels[0] ? `${labels[0].toLowerCase()} ` : ''
    const [one, many] = MAIN_NOUNS[category]
    const vegetarian = inCategory.filter(({ item }) => isVegetarian(item)).reduce((sum, line) => sum + line.quantity, 0)
    const ofThem =
      request.vegetarians === 0 || vegetarian === 0 ? '' : vegetarian === total ? ', all vegetarian' : `, ${vegetarian} of them vegetarian`
    return [`${total} ${size}${total === 1 ? one : many}${ofThem}`]
  })
  const mainsText = counted.join(counted.some((part) => part.includes(',')) ? ', and ' : ' and ')
  const sideNames = found.filter(({ item }) => item.category === SIDES).map(({ item }) => spokenName(item))
  const summary = `${mainsText}, plus ${andList([...sideNames, ...(request.drinks ? [drink] : [])])}`
  return { reason, summary }
}

// "Garlic Knots (6)" → "garlic knots"
function spokenName(item: MenuItem): string {
  return item.name.replace(/\s*\(.*\)$/, '').toLowerCase()
}

/** `count` shared over `kinds` as evenly as it goes, the first ones getting one more. */
function spread(count: number, kinds: number): number[] {
  return Array.from({ length: kinds }, (_, index) => Math.floor(count / kinds) + (index < count % kinds ? 1 : 0))
}

function itemFor(id: string): MenuItem | undefined {
  return menu.find((item) => item.id === id) ?? findVariant(id)?.item
}

/** Spicy items only when someone likes it spicy, or they asked for that one. */
function allowed(item: MenuItem, request: Request): boolean {
  return request.spicy || !isSpicy(item) || request.include.includes(item)
}

function isVegetarian(item: MenuItem): boolean {
  return item.tags.includes('vegetarian')
}

function isPopular(item: MenuItem): boolean {
  return item.tags.includes('popular')
}

function isSpicy(item: MenuItem): boolean {
  return item.tags.includes('spicy')
}

function isMainCategory(category: Category): category is MainCategory {
  return (MAIN_CATEGORIES as Category[]).includes(category)
}

function isGroupMains(value: unknown): value is GroupMains {
  return GROUP_MAINS.some((mains) => mains === value)
}

function isWholeNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function labelOf(category: Category): string {
  return categories.find((info) => info.id === category)?.label ?? category
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)]
}

// "a, b or c"
function orList(words: string[]): string {
  return words.length <= 2 ? words.join(' or ') : `${words.slice(0, -1).join(', ')} or ${words.at(-1)}`
}

// "a, b and c"
function andList(words: string[]): string {
  return words.length <= 2 ? words.join(' and ') : `${words.slice(0, -1).join(', ')} and ${words.at(-1)}`
}
