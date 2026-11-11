// Plans food for a group from menu.json: which mains, sides and drinks, and
// how many of each. The plan_group_order tool (handlers.ts) shows it on the
// suggestion card. The code does the math so the agent only has to talk: in
// the owner's run, asked for "a party of thirty, ten of them vegetarian", the
// LLM worked it out itself and proposed about twice the food.
//
// The owner's rules (SPEC.md, Decisions). To change them, edit the constants
// below; planGroupOrder.test.ts pins the plans they give.
// - Mains: about one serving per person, from each size's `serves`, rounded
//   up and never more than MAX_OVER over when the sizes allow. Large sizes
//   first; if they're more than MAX_OVER over, one large becomes the smaller
//   size (30 people: 8 larges feed 32, 7% over, so they stay).
// - Vegetarians eat from vegetarian-tagged mains, planned first (10: 3 larges).
// - Two to four kinds of mains, as many as there are mains to share out. A
//   small group gets two kinds from smaller sizes that feed as many as one
//   large (3 or 4 people: 2 mediums). Popular items first, plus what they asked
//   for by name, which can make more than four.
// - One shareable side per PEOPLE_PER_SIDE people (the owner said 4 to 5;
//   this is the lean end), from what the mains pair with.
// - One drink per person, unless they don't want drinks.
//
// What serves those rules, though the owner didn't ask for it:
// - For everyone else, mains with meat come before vegetarian ones (after the
//   popular ones), so the vegetarian mains are the vegetarians' and the plan's
//   "3 of them vegetarian" says what they get.
// - A spicy main only when someone likes it spicy (SPEC.md's question for a
//   group) or they asked for one by name.
// - In a mix, each main category covers an equal share, in whole large sizes.
// - A plan fits in one order next to what's already in the cart: no line goes
//   over MAX_LINE_QUANTITY counting the cart, and it's at most
//   MAX_LINES_PER_CALL lines. So "add all of that" is never refused. A group
//   too big for that gets a message with the largest group that fits.
//
// Which categories hold mains, sides and drinks, and how the summary counts
// them, comes from `categories` in menu.ts (`plan`, `noun`); sides are named
// by `spokenName`. Like tools.ts, this module imports nothing from React or
// the server, so evals can load it on its own.

import { isRecord } from '../isRecord'
import {
  categories,
  categoriesPlannedAs,
  defaultVariant,
  findItem,
  findVariant,
  mainCategories,
  menu,
  products,
  spokenName,
  type Category,
  type MainCategoryInfo,
  type MenuItem,
  type Variant,
} from '../menu/menu'
import { MAX_LINE_QUANTITY } from '../shop'
import { quantityOf, type ItemQuantity, type Quantities } from './cartSummary'
import { andList, orList, type Recovery } from './text'
import { GROUP_MAINS, MAX_LINES_PER_CALL, type GroupMains } from './tools'

/** Mains may feed this share more than the group, when the sizes allow. */
const MAX_OVER = 0.1
/** One side per this many people, rounded up. */
const PEOPLE_PER_SIDE = 5
/** The fewest kinds of mains in a plan, when there are that many mains to share out. */
const MIN_KINDS = 2
/** The most kinds of mains in a plan, unless they asked for more by name. */
const MAX_KINDS = 4
/** The most kinds of sides picked from what the mains pair with. */
const MAX_SIDE_KINDS = 2

const SIDE_CATEGORIES = categoriesPlannedAs('side')
const DRINK_CATEGORIES = categoriesPlannedAs('drink')
const PLANNED_CATEGORIES = categoriesPlannedAs('main', 'side', 'drink')

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
  /** A main category (pizza, the default, or subs), or a mix of them. */
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

/**
 * The plan for a group, or a short message the agent can act on. `request` is
 * what the agent sent (a `GroupOrderRequest`, if it got it right): every field
 * is checked at run time, since the agent can send anything. `inCart` is what's
 * in the cart now, by product id: the plan leaves room for it, so the cart can
 * take every line. It never throws, and the same request and cart always get
 * the same plan.
 */
export function planGroupOrder(request: Record<string, unknown>, inCart: Quantities = {}): GroupPlan | Recovery {
  const read = readRequest(request, inCart)
  if ('message' in read) return read
  const plan = buildPlan(read)
  if (plan) return plan

  // Too big for one order: say the largest group that fits, keeping everything else.
  const fits = (people: number) =>
    buildPlan({ ...read, people, vegetarians: Math.min(read.vegetarians, people) }) !== undefined
  let most = 0
  let tooMany = read.people
  while (tooMany - most > 1) {
    const middle = Math.floor((most + tooMany) / 2)
    if (fits(middle)) most = middle
    else tooMany = middle
  }
  // "Without drinks" means no drinks at all, so a drink asked for by name goes too.
  const withoutDrinks =
    read.drinks &&
    buildPlan({ ...read, drinks: false, include: read.include.filter((item) => !DRINK_CATEGORIES.includes(item.category)) }) !==
      undefined
  const counting = Object.keys(inCart).length > 0 ? ", counting what's already in the cart" : ''

  if (most === 0) {
    return {
      message: `Nothing on the menu fits that plan${counting}.` + (withoutDrinks ? ' Without drinks, it fits.' : ' Try other preferences.'),
    }
  }
  const upTo = `one order can feed up to ${most} ${most === 1 ? 'person' : 'people'}.`
  return {
    message:
      `That's more than one order holds: at most ${MAX_LINE_QUANTITY} of each item${counting}. ` +
      (withoutDrinks ? `With a drink each, ${upTo} Without drinks, all ${read.people} fit.` : `${upTo[0].toUpperCase()}${upTo.slice(1)}`),
  }
}

/** A request that passed the checks, with its defaults filled in. */
type CheckedRequest = {
  people: number
  vegetarians: number
  /** The main categories to plan from, in menu order. */
  mains: MainCategoryInfo[]
  spicy: boolean
  drinks: boolean
  include: MenuItem[]
  /** How many more of a product the cart can take: MAX_LINE_QUANTITY less what's in it. */
  room: (id: string) => number
}

function readRequest(request: Record<string, unknown>, inCart: Quantities): CheckedRequest | Recovery {
  const people = request.people
  if (!isWholeNumber(people) || people < 1) {
    return { message: 'people has to be how many are eating: a whole number, 1 or more.' }
  }
  const vegetarians = request.vegetarians ?? 0
  if (!isWholeNumber(vegetarians) || vegetarians < 0) return { message: 'vegetarians has to be a whole number, 0 or more.' }
  if (vegetarians > people) {
    return {
      message: `That's ${vegetarians} vegetarians in a group of ${people}. Ask how many people in all, and how many of them are vegetarian.`,
    }
  }

  const preferences = request.preferences ?? {}
  if (!isRecord(preferences)) return { message: 'preferences has to be an object, such as { "spicy": true }.' }
  const mains = preferences.mains ?? GROUP_MAINS[0]
  if (!isGroupMains(mains)) return { message: `mains has to be ${orList(GROUP_MAINS)}.` }
  const spicy = preferences.spicy ?? false
  if (typeof spicy !== 'boolean') return { message: 'spicy has to be true or false.' }
  const drinks = preferences.drinks ?? true
  if (typeof drinks !== 'boolean') return { message: 'drinks has to be true or false.' }

  const ids = preferences.include ?? []
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
  return {
    people,
    vegetarians,
    mains: mainCategories.filter(
      (category) => mains === 'mix' || mains === category.id || include.some((item) => item.category === category.id),
    ),
    spicy,
    drinks: drinks || include.some((item) => DRINK_CATEGORIES.includes(item.category)),
    include,
    room: (id) => Math.max(0, MAX_LINE_QUANTITY - quantityOf(inCart, id)),
  }
}

/** One size of a main category in a slot: how many one of it serves, and how many the slot has. */
type SizeCount = { serves: number; count: number }

/** The mains for one group (the vegetarians, or everyone else) from one category. */
type Slot = {
  category: MainCategoryInfo
  vegetarian: boolean
  /** The category's largest size: Large, or a sub's one size. */
  largest: SizeCount
  /** Its smallest size: Medium, or for subs the same size as the largest. */
  smallest: SizeCount
}

/** The plan, or undefined when it doesn't fit in one order next to what's in the cart. */
function buildPlan(request: CheckedRequest): GroupPlan | undefined {
  const { people, vegetarians } = request

  // 1. How many of each size: the vegetarians first, then everyone else.
  const vegetarianSlots = slotsFor(request, true, vegetarians)
  const otherSlots = slotsFor(request, false, Math.max(0, people - servingsOf(vegetarianSlots)))
  const over = servingsOf([...vegetarianSlots, ...otherSlots]) - people
  if (over > people * MAX_OVER) {
    // One large becomes the small size, where it still feeds everyone (and every vegetarian).
    const swap = [...otherSlots, ...vegetarianSlots].find(({ largest, smallest, vegetarian }) => {
      const fewer = largest.serves - smallest.serves
      return (
        largest.count > 0 && fewer > 0 && over >= fewer && (!vegetarian || servingsOf(vegetarianSlots) - fewer >= vegetarians)
      )
    })
    if (swap) {
      swap.largest.count--
      swap.smallest.count++
    }
  }
  const slots = [...vegetarianSlots, ...otherSlots].filter((slot) => unitsIn(slot) > 0)
  // Two kinds for a small group: a lone large becomes smaller sizes that feed as many (1 large → 2 mediums).
  if (sum(slots.map(unitsIn)) < MIN_KINDS) {
    const slot = slots.find(({ largest, smallest }) => largest.count > 0 && smallest.serves < largest.serves)
    if (slot && slot.largest.serves % slot.smallest.serves === 0) {
      slot.largest.count--
      slot.smallest.count += slot.largest.serves / slot.smallest.serves
    }
  }

  // 2. Which kinds, and how many of each.
  const spicy = request.spicy ? spicyPick(slots) : undefined
  const mustFor = (slot: Slot) =>
    unique([...request.include.filter((item) => slotFor(item, slots) === slot), ...(spicy?.slot === slot ? [spicy.item] : [])])
  const kinds = kindsPerSlot(
    slots,
    slots.map((slot) => mustFor(slot).length),
    slots.map((slot) => poolFor(slot, request, new Set()).length),
  )
  const used = new Set<MenuItem>()
  const lines: ItemQuantity[] = []
  const mains: Array<{ item: MenuItem; count: number }> = []
  for (const [index, slot] of slots.entries()) {
    const pool = poolFor(slot, request, used)
    const must = mustFor(slot).filter((item) => pool.includes(item))
    // Room on the size most of them are; a small size given with larges is checked with the lines below.
    const roomServes = slot.largest.count > 0 ? slot.largest.serves : slot.smallest.serves
    const picked = pickKinds(unitsIn(slot), kinds[index], must, pool, (item) => request.room(sizeOf(item, roomServes).id))
    if (!picked) return undefined

    // The large sizes go to the first kinds, the small ones to the last.
    let larges = slot.largest.count
    for (const { item, count } of picked) {
      used.add(item)
      mains.push({ item, count })
      const large = Math.min(count, larges)
      larges -= large
      if (large > 0) lines.push({ id: sizeOf(item, slot.largest.serves).id, quantity: large })
      if (count > large) lines.push({ id: sizeOf(item, slot.smallest.serves).id, quantity: count - large })
    }
  }

  // 3. Sides and drinks, from what the mains pair with, the mains with the most first.
  const pairs = [...mains]
    .sort((a, b) => b.count - a.count || menu.indexOf(a.item) - menu.indexOf(b.item))
    .flatMap(({ item }) => item.pairsWith)
  const sideCount = Math.ceil(people / PEOPLE_PER_SIDE)
  const sides = extras(SIDE_CATEGORIES, sideCount, MAX_SIDE_KINDS, pairs, request)
  const drinks = request.drinks ? extras(DRINK_CATEGORIES, people, 1, pairs, request) : []
  if (!sides || !drinks) return undefined
  lines.push(...sides, ...drinks)

  if (lines.length > MAX_LINES_PER_CALL || lines.some((line) => line.quantity > request.room(line.id))) return undefined
  lines.sort((a, b) => MENU_ORDER.indexOf(a.id) - MENU_ORDER.indexOf(b.id))
  return { title: `Party of ${people}`, ...describePlan(lines, request, sideCount), lines }
}

/** Every variant id, in menu order: the order a plan's lines are listed in. */
const MENU_ORDER = products.map((product) => product.id)

/** The slots one group needs to be fed `servings`, one per main category. */
function slotsFor(request: CheckedRequest, vegetarian: boolean, servings: number): Slot[] {
  if (servings === 0) return []
  let left = servings
  return request.mains.map((category, index) => {
    const { largest, smallest } = sizesOf(category.id)
    // In a mix, each category but the last takes an equal share in whole large sizes; the last makes up the rest.
    const count =
      index === request.mains.length - 1 ? Math.ceil(left / largest) : Math.round(servings / request.mains.length / largest)
    left = Math.max(0, left - count * largest)
    return { category, vegetarian, largest: { serves: largest, count }, smallest: { serves: smallest, count: 0 } }
  })
}

function servingsOf(slots: Slot[]): number {
  return slots.reduce((sum, { largest, smallest }) => sum + largest.count * largest.serves + smallest.count * smallest.serves, 0)
}

/** How many mains a slot has, of any size. */
function unitsIn(slot: Slot): number {
  return slot.largest.count + slot.smallest.count
}

/**
 * How many a category's largest and smallest sizes serve. The planner assumes
 * a category's items share their sizes, as every pizza is Medium for 2 and
 * Large for 4; planGroupOrder.test.ts checks menu.json keeps to that.
 */
export function sizesOf(category: Category): { largest: number; smallest: number } {
  const serves = menu.find((item) => item.category === category)?.variants.map((variant) => variant.serves) ?? [1]
  return { largest: Math.max(...serves), smallest: Math.min(...serves) }
}

/** The item's size that serves this many, or its largest. */
function sizeOf(item: MenuItem, serves: number): Variant {
  return item.variants.find((variant) => variant.serves === serves) ?? defaultVariant(item)
}

/**
 * How many kinds each slot gets: MIN_KINDS to MAX_KINDS in all, as many as
 * there are mains to share out, each slot at least one and every kind asked
 * for in it. The rest go one at a time to the slot with the most mains for
 * each kind it has, while its pool has more (30 people, 10 vegetarian: 3
 * vegetarian larges and 5 others get two kinds each).
 */
function kindsPerSlot(slots: Slot[], must: number[], poolSizes: number[]): number[] {
  const units = slots.map(unitsIn)
  const kinds = slots.map((_, index) => Math.max(1, must[index]))
  const total = Math.min(MAX_KINDS, sum(units))
  for (let given = sum(kinds); given < total; given++) {
    let best = -1
    for (const index of slots.keys()) {
      const canTakeOne = kinds[index] < units[index] && kinds[index] < poolSizes[index]
      if (canTakeOne && (best === -1 || units[index] / kinds[index] > units[best] / kinds[best])) best = index
    }
    if (best === -1) break
    kinds[best]++
  }
  return kinds
}

/**
 * What a slot can pick from, best first: popular items, then the rest, and for
 * everyone else, items with meat before vegetarian ones, since the vegetarians
 * have their own. Spicy items only when someone likes it spicy or asked for
 * one, and nothing another slot already has. Menu order breaks ties.
 */
function poolFor(slot: Slot, request: CheckedRequest, used: Set<MenuItem>): MenuItem[] {
  const rank = (item: MenuItem) => (isPopular(item) ? 0 : 2) + (isVegetarian(item) ? 1 : 0)
  return menu
    .filter(
      (item) =>
        item.category === slot.category.id &&
        !used.has(item) &&
        (!slot.vegetarian || isVegetarian(item)) &&
        allowed(item, request),
    )
    .sort((a, b) => rank(a) - rank(b))
}

/** The slot an asked-for main goes in: the vegetarians' if it's vegetarian and they have one, else everyone else's. */
function slotFor(item: MenuItem, slots: Slot[]): Slot | undefined {
  const inCategory = slots.filter((slot) => slot.category.id === item.category)
  return (isVegetarian(item) ? inCategory.find((slot) => slot.vegetarian) : undefined) ?? inCategory.find((slot) => !slot.vegetarian)
}

/** The spicy main for someone who likes it spicy: everyone else's first, then the vegetarians'. */
function spicyPick(slots: Slot[]): { slot: Slot; item: MenuItem } | undefined {
  const order = [...slots.filter((slot) => !slot.vegetarian), ...slots.filter((slot) => slot.vegetarian)]
  for (const slot of order) {
    const item = menu.find(
      (candidate) =>
        candidate.category === slot.category.id && isSpicy(candidate) && (!slot.vegetarian || isVegetarian(candidate)),
    )
    if (item) return { slot, item }
  }
  return undefined
}

/**
 * `count` sides or drinks from these categories: the kinds asked for, or else
 * up to `pairedKinds` of what the mains pair with, or else the popular one,
 * and more when those can't hold `count` next to what's in the cart.
 * Undefined when the categories can't hold that many.
 */
function extras(
  from: Category[],
  count: number,
  pairedKinds: number,
  pairs: string[],
  request: CheckedRequest,
): ItemQuantity[] | undefined {
  const fits = (item: MenuItem | undefined): item is MenuItem =>
    item !== undefined && from.includes(item.category) && allowed(item, request)
  const asked = request.include.filter(fits)
  const paired = unique(pairs.map(findItem).filter(fits))
  const rest = menu.filter(fits).sort((a, b) => Number(isPopular(b)) - Number(isPopular(a)))
  const wanted = Math.max(asked.length, Math.min(paired.length, pairedKinds), 1)
  const picked = pickKinds(count, wanted, asked, unique([...paired, ...rest]), (item) => request.room(defaultVariant(item).id))
  return picked?.map(({ item, count: quantity }) => ({ id: defaultVariant(item).id, quantity }))
}

/**
 * Shares `count` over a few kinds: every one in `must`, then the best of
 * `pool`, `wanted` in all (fewer when `count` is smaller, more when
 * MAX_LINE_QUANTITY a line can't hold them), as evenly as `room` allows, how
 * many more of an item the cart can take. What the cart leaves no room for
 * goes to the next kinds, as many each as they take: a party of 20 with a
 * soda already in the cart gets 19 sodas and a lemonade. Items without room
 * are skipped. The kinds come back in `pool`'s order, best first, each with
 * its share. Undefined when they can't hold `count`. `must` is part of `pool`.
 */
function pickKinds(
  count: number,
  wanted: number,
  must: MenuItem[],
  pool: MenuItem[],
  room: (item: MenuItem) => number,
): Array<{ item: MenuItem; count: number }> | undefined {
  const candidates = unique([...must, ...pool]).filter((item) => room(item) > 0)
  let take = Math.min(count, Math.max(wanted, must.length), candidates.length)
  while (take < candidates.length && take * MAX_LINE_QUANTITY < count) take++
  const kinds = candidates.slice(0, take).sort((a, b) => pool.indexOf(a) - pool.indexOf(b))
  const counts = share(count, kinds.map(room))
  const picked = kinds.map((item, index) => ({ item, count: counts[index] }))

  let left = count - sum(counts)
  for (const item of candidates.slice(take)) {
    if (left === 0) break
    const spilled = Math.min(left, room(item))
    picked.push({ item, count: spilled })
    left -= spilled
  }
  return left === 0 ? picked : undefined
}

/**
 * `count` shared over kinds as evenly as each one's room allows, the first ones
 * getting one more when it doesn't go evenly: 5 over three is 2, 2 and 1.
 * When their room together is less than `count`, each gets all its room.
 */
function share(count: number, rooms: number[]): number[] {
  const counts = rooms.map(() => 0)
  let left = count
  for (;;) {
    const open = rooms.flatMap((room, index) => (counts[index] < room ? [index] : []))
    if (left === 0 || open.length === 0) return counts
    const each = Math.floor(left / open.length)
    if (each === 0) {
      for (const index of open.slice(0, left)) counts[index]++
      return counts
    }
    for (const index of open) {
      const added = Math.min(each, rooms[index] - counts[index])
      counts[index] += added
      left -= added
    }
  }
}

/** The card's reason and the agent's summary, in words. */
function describePlan(lines: ItemQuantity[], request: CheckedRequest, sideCount: number): Pick<GroupPlan, 'reason' | 'summary'> {
  const found = lines.flatMap((line) => {
    const variant = findVariant(line.id)
    return variant ? [{ ...line, ...variant }] : []
  })
  const mains = found.filter(({ item }) => request.mains.some((category) => category.id === item.category))
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
    const inCategory = mains.filter(({ item }) => item.category === category.id)
    const total = inCategory.reduce((sum, line) => sum + line.quantity, 0)
    if (total === 0) return []
    const labels = unique(inCategory.map(({ variant }) => variant.label))
    const size = labels.length === 1 && labels[0] ? `${labels[0].toLowerCase()} ` : ''
    const [one, many] = category.noun
    const vegetarian = inCategory.filter(({ item }) => isVegetarian(item)).reduce((sum, line) => sum + line.quantity, 0)
    const ofThem =
      request.vegetarians === 0 || vegetarian === 0 ? '' : vegetarian === total ? ', all vegetarian' : `, ${vegetarian} of them vegetarian`
    return [`${total} ${size}${total === 1 ? one : many}${ofThem}`]
  })
  const mainsText = counted.join(counted.some((part) => part.includes(',')) ? ', and ' : ' and ')
  const sideNames = found.filter(({ item }) => SIDE_CATEGORIES.includes(item.category)).map(({ item }) => spokenName(item))
  const summary = `${mainsText}, plus ${andList([...sideNames, ...(request.drinks ? [drink] : [])])}`
  return { reason, summary }
}

function itemFor(id: string): MenuItem | undefined {
  return findItem(id) ?? findVariant(id)?.item
}

/** Spicy items only when someone likes it spicy, or they asked for that one. */
function allowed(item: MenuItem, request: CheckedRequest): boolean {
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

function isGroupMains(value: unknown): value is GroupMains {
  return GROUP_MAINS.some((mains) => mains === value)
}

function isWholeNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value)
}

function labelOf(category: Category): string {
  return categories.find((info) => info.id === category)?.label ?? category
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)]
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0)
}
