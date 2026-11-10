import { describe, expect, it } from 'vitest'
import { findVariant, menu, type Category } from '../menu/menu'
import { MAX_LINE_QUANTITY } from '../shop'
import type { ItemQuantity } from './cartSummary'
import { planGroupOrder, sizesOf, type GroupOrderRequest, type GroupPlan } from './planGroupOrder'
import { MAX_LINES_PER_CALL } from './tools'

/** The plan, or a failed test naming the message it returned instead. */
function plan(request: GroupOrderRequest): GroupPlan {
  const result = planGroupOrder(request)
  if ('message' in result) throw new Error(`No plan for ${JSON.stringify(request)}: ${result.message}`)
  return result
}

function found(id: string) {
  const variant = findVariant(id)
  if (!variant) throw new Error(`${id} isn't on the menu`)
  return variant
}

const MAINS: Category[] = ['pizza', 'subs']

function isMain({ id }: ItemQuantity) {
  return MAINS.includes(found(id).item.category)
}

function isVegetarian({ id }: ItemQuantity) {
  return found(id).item.tags.includes('vegetarian')
}

function inCategory(category: Category) {
  return ({ id }: ItemQuantity) => found(id).item.category === category
}

/** How many people these lines feed, from each variant's `serves` in menu.json. */
function servings(lines: ItemQuantity[]): number {
  return lines.reduce((sum, line) => sum + found(line.id).variant.serves * line.quantity, 0)
}

function count(lines: ItemQuantity[]): number {
  return lines.reduce((sum, line) => sum + line.quantity, 0)
}

function large(id: string) {
  return found(id).variant.label === 'Large'
}

describe('planGroupOrder', () => {
  it('plans a party of 30 with 10 vegetarians as 8 large pizzas (32 servings), 3 of them veggie, plus sides and 30 drinks', () => {
    const result = plan({ people: 30, vegetarians: 10 })
    const mains = result.lines.filter(isMain)

    expect(mains.every((line) => large(line.id) && inCategory('pizza')(line))).toBe(true)
    expect(count(mains)).toBe(8)
    expect(servings(mains)).toBe(32)
    expect(count(mains.filter(isVegetarian))).toBe(3)
    expect(servings(mains.filter(isVegetarian))).toBe(12)
    expect(count(result.lines.filter(inCategory('sides')))).toBe(6)
    expect(count(result.lines.filter(inCategory('drinks')))).toBe(30)

    expect(result).toEqual({
      title: 'Party of 30',
      reason: 'Mains for 32 (12 vegetarian), sides to share and a drink each.',
      summary: '8 large pizzas, 3 of them vegetarian, plus garlic knots and a drink each',
      lines: [
        { id: 'cheese-pizza-large', quantity: 2 },
        { id: 'pepperoni-pizza-large', quantity: 3 },
        { id: 'margherita-pizza-large', quantity: 1 },
        { id: 'meat-lovers-pizza-large', quantity: 2 },
        { id: 'garlic-knots', quantity: 6 },
        { id: 'soda', quantity: 15 },
        { id: 'lemonade', quantity: 15 },
      ],
    })
  })

  it('plans a party of 20 with no vegetarians as 5 large pizzas of the two popular kinds', () => {
    expect(plan({ people: 20 })).toEqual({
      title: 'Party of 20',
      reason: 'Mains for 20, sides to share and a drink each.',
      summary: '5 large pizzas, plus garlic knots and a drink each',
      lines: [
        { id: 'cheese-pizza-large', quantity: 2 },
        { id: 'pepperoni-pizza-large', quantity: 3 },
        { id: 'garlic-knots', quantity: 4 },
        { id: 'soda', quantity: 20 },
      ],
    })
    expect(plan({ people: 20, vegetarians: 0 })).toEqual(plan({ people: 20 }))
  })

  it('plans 8 with 2 vegetarians as one veggie and one pepperoni large', () => {
    expect(plan({ people: 8, vegetarians: 2 }).lines).toEqual([
      { id: 'cheese-pizza-large', quantity: 1 },
      { id: 'pepperoni-pizza-large', quantity: 1 },
      { id: 'garlic-knots', quantity: 2 },
      { id: 'soda', quantity: 8 },
    ])
  })

  it('plans 4 as one large pizza', () => {
    expect(plan({ people: 4 })).toEqual({
      title: 'Party of 4',
      reason: 'Mains for 4, a side and a drink each.',
      summary: '1 large pizza, plus garlic knots and a drink each',
      lines: [
        { id: 'pepperoni-pizza-large', quantity: 1 },
        { id: 'garlic-knots', quantity: 1 },
        { id: 'soda', quantity: 4 },
      ],
    })
  })

  it('plans 1 as a medium, the smallest size, rather than a large', () => {
    expect(plan({ people: 1 })).toEqual({
      title: 'Party of 1',
      reason: 'Mains for 2, a side and a drink.',
      summary: '1 medium pizza, plus garlic knots and a drink',
      lines: [
        { id: 'pepperoni-pizza-medium', quantity: 1 },
        { id: 'garlic-knots', quantity: 1 },
        { id: 'soda', quantity: 1 },
      ],
    })
  })

  it('swaps one large for a medium when all larges would be more than 10% over', () => {
    // 10 people: 3 larges would feed 12 (20% over), so it's 2 larges and a medium.
    const result = plan({ people: 10 })
    expect(result.lines.filter(isMain)).toEqual([
      { id: 'cheese-pizza-medium', quantity: 1 },
      { id: 'pepperoni-pizza-large', quantity: 2 },
    ])
    expect(result.summary).toBe('3 pizzas, plus garlic knots and a drink each')
    // 22 people: 6 larges feed 24, 9% over, so they stay.
    expect(servings(plan({ people: 22 }).lines.filter(isMain))).toBe(24)
  })

  it('leaves out the drinks when they say no drinks', () => {
    const result = plan({ people: 20, preferences: { drinks: false } })
    expect(result.lines.filter(inCategory('drinks'))).toEqual([])
    expect(result.lines).toEqual(plan({ people: 20 }).lines.filter((line) => !inCategory('drinks')(line)))
    expect(result.reason).toBe('Mains for 20 and sides to share.')
    expect(result.summary).toBe('5 large pizzas, plus garlic knots')
  })

  it('plans subs one per person, with the vegetarian sub for the vegetarians and fries on the side', () => {
    const result = plan({ people: 30, vegetarians: 10, preferences: { mains: 'subs' } })
    expect(result.lines).toEqual([
      { id: 'italian-sub', quantity: 10 },
      { id: 'philly-cheesesteak', quantity: 10 },
      { id: 'eggplant-parm-sub', quantity: 10 },
      { id: 'fries', quantity: 6 },
      { id: 'soda', quantity: 15 },
      { id: 'lemonade', quantity: 15 },
    ])
    expect(result.summary).toBe('30 subs, 10 of them vegetarian, plus fries and a drink each')
  })

  it('plans a mix with large pizzas for about half and subs for the rest', () => {
    const result = plan({ people: 30, vegetarians: 10, preferences: { mains: 'mix' } })
    expect(result.lines).toEqual([
      { id: 'cheese-pizza-large', quantity: 1 },
      { id: 'pepperoni-pizza-large', quantity: 3 },
      { id: 'philly-cheesesteak', quantity: 8 },
      { id: 'eggplant-parm-sub', quantity: 6 },
      { id: 'garlic-knots', quantity: 3 },
      { id: 'fries', quantity: 3 },
      { id: 'soda', quantity: 15 },
      { id: 'lemonade', quantity: 15 },
    ])
    expect(servings(result.lines.filter(isMain))).toBe(30)
    expect(servings(result.lines.filter(isMain).filter(isVegetarian))).toBe(10)
    expect(result.summary).toBe(
      '4 large pizzas, 1 of them vegetarian, and 14 subs, 6 of them vegetarian, plus garlic knots, fries and a drink each',
    )
  })

  it('adds a spicy pizza when someone likes it spicy, and none otherwise', () => {
    const spicy = plan({ people: 30, vegetarians: 10, preferences: { spicy: true } })
    expect(spicy.lines).toEqual([
      { id: 'cheese-pizza-large', quantity: 2 },
      { id: 'pepperoni-pizza-large', quantity: 3 },
      { id: 'margherita-pizza-large', quantity: 1 },
      { id: 'buffalo-chicken-pizza-large', quantity: 2 },
      { id: 'garlic-knots', quantity: 3 },
      { id: 'mozzarella-sticks', quantity: 3 },
      { id: 'soda', quantity: 15 },
      { id: 'lemonade', quantity: 15 },
    ])
    expect(servings(spicy.lines.filter(isMain))).toBe(32)
    expect(servings(spicy.lines.filter(isMain).filter(isVegetarian))).toBe(12)

    for (const people of [4, 8, 20, 30, 40]) {
      const lines = plan({ people, vegetarians: Math.floor(people / 3) }).lines
      expect(lines.some(({ id }) => found(id).item.tags.includes('spicy')), `${people}`).toBe(false)
    }
  })

  it('includes what the customer asked for, by item id or variant id', () => {
    const lines = plan({ people: 30, vegetarians: 10, preferences: { include: ['white-pizza'] } }).lines
    expect(lines.filter(isVegetarian).filter(isMain)).toEqual([
      { id: 'cheese-pizza-large', quantity: 2 },
      { id: 'white-pizza-large', quantity: 1 },
    ])
    expect(plan({ people: 30, vegetarians: 10, preferences: { include: ['white-pizza-large'] } }).lines).toEqual(lines)

    // An asked-for drink or side takes the place of the usual one.
    const lemonade = plan({ people: 8, preferences: { include: ['lemonade', 'fries'] } }).lines
    expect(lemonade.filter((line) => !isMain(line))).toEqual([
      { id: 'fries', quantity: 2 },
      { id: 'lemonade', quantity: 8 },
    ])
  })

  it('makes it a mix when they ask for a sub by name with pizza', () => {
    const lines = plan({ people: 12, preferences: { include: ['philly-cheesesteak'] } }).lines
    expect(lines.filter(isMain)).toEqual([
      { id: 'cheese-pizza-large', quantity: 1 },
      { id: 'pepperoni-pizza-large', quantity: 1 },
      { id: 'italian-sub', quantity: 2 },
      { id: 'philly-cheesesteak', quantity: 2 },
    ])
  })

  it('gives the same plan for the same request, every time', () => {
    const request: GroupOrderRequest = {
      people: 23,
      vegetarians: 7,
      preferences: { mains: 'mix', spicy: true, include: ['white-pizza', 'lemonade'] },
    }
    const first = planGroupOrder(request)
    expect(planGroupOrder(structuredClone(request))).toEqual(first)
    expect(
      planGroupOrder({ preferences: { include: ['white-pizza', 'lemonade'], spicy: true, mains: 'mix' }, vegetarians: 7, people: 23 }),
    ).toEqual(first)
  })

  it('keeps to its rules for every group from 1 to 40 people, with and without vegetarians', () => {
    for (let people = 1; people <= 40; people++) {
      for (const vegetarians of new Set([0, Math.floor(people / 3), people])) {
        const name = `${people} people, ${vegetarians} vegetarian`
        const { lines } = plan({ people, vegetarians })
        const mains = lines.filter(isMain)
        const fed = servings(mains)

        // About one serving per person: never short, and never more than 10% over unless the sizes can't do better.
        expect(fed, name).toBeGreaterThanOrEqual(people)
        expect(fed - people <= 1 || fed - people <= people * 0.1, `${name}: feeds ${fed}`).toBe(true)
        expect(servings(mains.filter(isVegetarian)), name).toBeGreaterThanOrEqual(vegetarians)
        // Two to four kinds of mains, when there are enough of them to share out.
        expect(mains.length, name).toBeGreaterThanOrEqual(Math.min(2, count(mains)))
        expect(new Set(mains.map(({ id }) => found(id).item.id)).size, name).toBeLessThanOrEqual(4)
        // One side per 5 people, one drink each.
        expect(count(lines.filter(inCategory('sides'))), name).toBe(Math.ceil(people / 5))
        expect(count(lines.filter(inCategory('drinks'))), name).toBe(people)
        // What one tool call and one cart line can take.
        expect(lines.length, name).toBeLessThanOrEqual(MAX_LINES_PER_CALL)
        for (const line of lines) expect(line.quantity, `${name}: ${line.id}`).toBeLessThanOrEqual(MAX_LINE_QUANTITY)
        expect(new Set(lines.map(({ id }) => id)).size, name).toBe(lines.length)
      }
    }
  })

  it('says how many it can plan for when a group is too big for one order', () => {
    // Two drinks on the menu, 20 of each at most: 40 drinks.
    expect(planGroupOrder({ people: 100, vegetarians: 25 })).toEqual({
      message:
        "That's more than one order holds (at most 20 of each item), so a plan can feed up to 40 people at a time. Without drinks, all 100 fit.",
    })
    expect(plan({ people: 40, vegetarians: 25 }).lines.filter(inCategory('drinks'))).toEqual([
      { id: 'soda', quantity: 20 },
      { id: 'lemonade', quantity: 20 },
    ])

    const noDrinks = plan({ people: 100, vegetarians: 25, preferences: { drinks: false } })
    expect(servings(noDrinks.lines.filter(isMain))).toBe(100)
    for (const line of noDrinks.lines) expect(line.quantity).toBeLessThanOrEqual(MAX_LINE_QUANTITY)

    // Even without drinks, the pizzas run out of lines at some point. The message names the most that fits.
    const huge = planGroupOrder({ people: 1000, preferences: { drinks: false } })
    expect(huge).toHaveProperty('message')
    const most = Number(/up to (\d+) people/.exec((huge as { message: string }).message)?.[1])
    expect(most).toBeGreaterThan(100)
    expect(planGroupOrder({ people: most, preferences: { drinks: false } })).toHaveProperty('lines')
    expect(planGroupOrder({ people: most + 1, preferences: { drinks: false } })).toHaveProperty('message')
    expect((huge as { message: string }).message).not.toContain('Without drinks')
  })

  it.each([
    [{ people: 0 }, 'people has to be how many are eating: a whole number, 1 or more.'],
    [{ people: -3 }, 'people has to be how many are eating: a whole number, 1 or more.'],
    [{ people: 2.5 }, 'people has to be how many are eating: a whole number, 1 or more.'],
    [{ people: '30' }, 'people has to be how many are eating: a whole number, 1 or more.'],
    [{}, 'people has to be how many are eating: a whole number, 1 or more.'],
    [{ people: 10, vegetarians: -1 }, 'vegetarians has to be a whole number, 0 or more.'],
    [
      { people: 10, vegetarians: 12 },
      "That's 12 vegetarians in a group of 10. Ask how many people in all, and how many of them are vegetarian.",
    ],
    [{ people: 10, preferences: { mains: 'tacos' } }, 'mains has to be pizza, subs or mix.'],
    [{ people: 10, preferences: { spicy: 'yes' } }, 'spicy has to be true or false.'],
    [{ people: 10, preferences: { drinks: 'no' } }, 'drinks has to be true or false.'],
    [{ people: 10, preferences: 'spicy' }, 'preferences has to be an object, such as { "spicy": true }.'],
    [{ people: 10, preferences: { include: 'white-pizza' } }, 'include has to be a list of item ids, such as ["white-pizza"].'],
    [
      { people: 10, preferences: { include: ['hawaiian-pizza'] } },
      'There\'s no "hawaiian-pizza" on the menu. include takes item ids, such as "white-pizza".',
    ],
    [
      { people: 10, preferences: { include: ['buffalo-wings'] } },
      'plan_group_order plans pizza, subs, sides and drinks, not Buffalo Wing Dings. Plan without it, then add it to the card with show_suggestions.',
    ],
  ])('answers %j with a message instead of throwing', (request, message) => {
    // The agent can send anything, so the request is checked at run time.
    expect(planGroupOrder(request as GroupOrderRequest)).toEqual({ message })
  })

  it('can count on every pizza, and every sub, having the same sizes, as it assumes', () => {
    for (const category of MAINS) {
      const { big, small } = sizesOf(category)
      for (const item of menu.filter((menuItem) => menuItem.category === category)) {
        const serves = item.variants.map((variant) => variant.serves)
        expect([Math.max(...serves), Math.min(...serves)], item.id).toEqual([big, small])
      }
    }
  })

  it('takes null as not given, the way the agent may send a field it leaves out', () => {
    expect(
      planGroupOrder({ people: 20, vegetarians: null, preferences: { mains: null, include: null } } as unknown as GroupOrderRequest),
    ).toEqual(plan({ people: 20 }))
    expect(planGroupOrder({ people: 20, preferences: null } as unknown as GroupOrderRequest)).toEqual(plan({ people: 20 }))
  })
})
