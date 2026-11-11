import { describe, expect, it } from 'vitest'
import { categories, findItem, findVariant, mainCategories, menu, spokenName, type Category } from '../menu/menu'
import { DELIVERY_FEE, MAX_LINE_QUANTITY } from '../shop'
import type { ItemQuantity, Quantities } from './cartSummary'
import { checkLinesToAdd } from './handlers'
import { planGroupOrder, sizesOf, type GroupOrderRequest, type GroupPlan } from './planGroupOrder'
import { MAX_LINES_PER_CALL } from './tools'

/** The plan, or a failed test naming the message it returned instead. */
function plan(request: GroupOrderRequest, inCart: Quantities = {}): GroupPlan {
  const result = planGroupOrder(request, inCart)
  if ('message' in result) throw new Error(`No plan for ${JSON.stringify(request)}: ${result.message}`)
  return result
}

/** The message, or a failed test naming the plan it returned instead. */
function message(request: GroupOrderRequest, inCart: Quantities = {}): string {
  const result = planGroupOrder(request, inCart)
  if (!('message' in result)) throw new Error(`A plan for ${JSON.stringify(request)}, not a message`)
  return result.message
}

/** How many different items (not sizes) these lines hold. */
function kinds(lines: ItemQuantity[]): number {
  return new Set(lines.map(({ id }) => found(id).item.id)).size
}

function found(id: string) {
  const variant = findVariant(id)
  if (!variant) throw new Error(`${id} isn't on the menu`)
  return variant
}

const MAINS: Category[] = mainCategories.map((category) => category.id)

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
      title: 'For your party of 30',
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

  it('plans a party of 20 with no vegetarians as 5 large pizzas of four kinds, the popular ones first', () => {
    expect(plan({ people: 20 })).toEqual({
      title: 'For your party of 20',
      reason: 'Mains for 20, sides to share and a drink each.',
      summary: '5 large pizzas, plus garlic knots and a drink each',
      lines: [
        { id: 'cheese-pizza-large', quantity: 1 },
        { id: 'pepperoni-pizza-large', quantity: 2 },
        { id: 'margherita-pizza-large', quantity: 1 },
        { id: 'meat-lovers-pizza-large', quantity: 1 },
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

  it('plans 4 as two medium pizzas of two kinds, which feed as many as one large', () => {
    expect(plan({ people: 4 })).toEqual({
      title: 'For your party of 4',
      reason: 'Mains for 4, a side and a drink each.',
      summary: '2 medium pizzas, plus garlic knots and a drink each',
      lines: [
        { id: 'cheese-pizza-medium', quantity: 1 },
        { id: 'pepperoni-pizza-medium', quantity: 1 },
        { id: 'garlic-knots', quantity: 1 },
        { id: 'soda', quantity: 4 },
      ],
    })
  })

  it('gives a small group two kinds with mediums, without feeding more people than one large would', () => {
    // 3 people: 1 large or 2 mediums both feed 4, so it's 2 mediums of two kinds.
    expect(plan({ people: 3 }).lines.filter(isMain)).toEqual([
      { id: 'cheese-pizza-medium', quantity: 1 },
      { id: 'pepperoni-pizza-medium', quantity: 1 },
    ])
    // 2 people: one medium feeds them; two would be twice the food, so it stays one kind.
    expect(plan({ people: 2 }).lines.filter(isMain)).toEqual([{ id: 'pepperoni-pizza-medium', quantity: 1 }])
    // 4 people, all vegetarian: two vegetarian mediums.
    expect(plan({ people: 4, vegetarians: 4 }).lines.filter(isMain)).toEqual([
      { id: 'cheese-pizza-medium', quantity: 1 },
      { id: 'margherita-pizza-medium', quantity: 1 },
    ])
  })

  it('plans 1 as a medium, the smallest size, rather than a large', () => {
    expect(plan({ people: 1 })).toEqual({
      title: 'Just for you',
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
      { id: 'cheese-pizza-large', quantity: 1 },
      { id: 'pepperoni-pizza-large', quantity: 1 },
      { id: 'meat-lovers-pizza-medium', quantity: 1 },
    ])
    expect(servings(result.lines.filter(isMain))).toBe(10)
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

  it('plans subs one per person, with the vegetarian sub for the vegetarians and four kinds in all', () => {
    const result = plan({ people: 30, vegetarians: 10, preferences: { mains: 'subs' } })
    expect(result.lines).toEqual([
      { id: 'italian-sub', quantity: 7 },
      { id: 'meatball-parm-sub', quantity: 6 },
      { id: 'philly-cheesesteak', quantity: 7 },
      { id: 'eggplant-parm-sub', quantity: 10 },
      { id: 'garlic-knots', quantity: 3 },
      { id: 'fries', quantity: 3 },
      { id: 'soda', quantity: 15 },
      { id: 'lemonade', quantity: 15 },
    ])
    expect(result.summary).toBe('30 subs, 10 of them vegetarian, plus garlic knots, fries and a drink each')
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
        // Two to four kinds of mains: two whenever there are two mains to share out, which takes 3 people.
        expect(kinds(mains), name).toBeGreaterThanOrEqual(Math.min(2, count(mains)))
        if (people >= 3) expect(kinds(mains), name).toBeGreaterThanOrEqual(2)
        expect(kinds(mains), name).toBeLessThanOrEqual(4)
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

  it('says how many one order can feed when a group is too big for it, and only what is true', () => {
    // Two drinks on the menu, 20 of each at most: 40 drinks.
    expect(planGroupOrder({ people: 100, vegetarians: 25 })).toEqual({
      message:
        "That's more than one order holds: at most 20 of each item. With a drink each, one order can feed up to 40 people. Without drinks, all 100 fit.",
    })
    expect(planGroupOrder({ people: 40, vegetarians: 25 })).toHaveProperty('lines')
    expect(planGroupOrder({ people: 41, vegetarians: 25 })).toHaveProperty('message')
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
    expect((huge as { message: string }).message).toBe(
      `That's more than one order holds: at most 20 of each item. One order can feed up to ${most} people.`,
    )
  })

  it('counts what is in the cart in the big-group message, and its numbers hold for that cart', () => {
    const inCart = { soda: 1 }
    expect(message({ people: 100 }, inCart)).toBe(
      "That's more than one order holds: at most 20 of each item, counting what's already in the cart. With a drink each, one order can feed up to 39 people. Without drinks, all 100 fit.",
    )
    expect(planGroupOrder({ people: 39 }, inCart)).toHaveProperty('lines')
    expect(planGroupOrder({ people: 40 }, inCart)).toHaveProperty('message')
    expect(planGroupOrder({ people: 100, preferences: { drinks: false } }, inCart)).toHaveProperty('lines')

    // With every drink line full, no group gets a drink each, but it fits without drinks.
    expect(message({ people: 8 }, { soda: 20, lemonade: 20 })).toBe(
      "Nothing on the menu fits that plan, counting what's already in the cart. Without drinks, it fits.",
    )
    // "Without drinks" means it: a drink asked for by name goes too.
    expect(message({ people: 8, preferences: { include: ['lemonade'] } }, { soda: 20, lemonade: 20 })).toContain(
      'Without drinks, it fits.',
    )
    expect(planGroupOrder({ people: 8, preferences: { drinks: false } }, { soda: 20, lemonade: 20 })).toHaveProperty('lines')
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
  ])('answers %j with a message instead of throwing', (request, expected) => {
    // The agent can send anything, so the request is checked at run time.
    expect(planGroupOrder(request)).toEqual({ message: expected })
  })

  it('can count on every pizza, and every sub, having the same sizes, as it assumes', () => {
    for (const category of MAINS) {
      const { largest, smallest } = sizesOf(category)
      for (const item of menu.filter((menuItem) => menuItem.category === category)) {
        const serves = item.variants.map((variant) => variant.serves)
        expect([Math.max(...serves), Math.min(...serves)], item.id).toEqual([largest, smallest])
      }
    }
  })

  it('takes null as not given, the way the agent may send a field it leaves out', () => {
    expect(planGroupOrder({ people: 20, vegetarians: null, preferences: { mains: null, include: null } })).toEqual(
      plan({ people: 20 }),
    )
    expect(planGroupOrder({ people: 20, preferences: null })).toEqual(plan({ people: 20 }))
  })
})

describe('planGroupOrder with items already in the cart', () => {
  /** Whether add_items would take these lines into this cart: the check "add all of that" runs. */
  function addable(lines: ItemQuantity[], inCart: Quantities) {
    return checkLinesToAdd(lines, inCart)
  }

  it('leaves room for a soda already in the cart, so "add all of that" for a party of 20 is never refused', () => {
    // After the cheeseburger's pairings added a soda: 20 more would make 21 on the line.
    const inCart = { 'classic-cheeseburger': 1, fries: 1, soda: 1 }
    const result = plan({ people: 20 }, inCart)

    // As many sodas as the line takes, and a lemonade for the one that doesn't fit: the least change to the plan.
    expect(result.lines.filter(inCategory('drinks'))).toEqual([
      { id: 'soda', quantity: 19 },
      { id: 'lemonade', quantity: 1 },
    ])
    expect(result.lines.filter((line) => !inCategory('drinks')(line))).toEqual(
      plan({ people: 20 }).lines.filter((line) => !inCategory('drinks')(line)),
    )
    expect(addable(result.lines, inCart)).toEqual({ lines: result.lines })
    expect(addable(plan({ people: 20 }).lines, inCart)).toHaveProperty('message')
  })

  it('never plans a line that, with what the cart holds, would go over the line cap', () => {
    // Each cart leaves room for a plan: 30 people need room for 30 drinks, and 10 vegetarians on subs for 10 eggplant parms.
    const carts: Quantities[] = [
      { soda: 1 },
      { soda: 5, lemonade: 3 },
      { 'pepperoni-pizza-large': 19 },
      { 'cheese-pizza-large': 20, 'cheese-pizza-medium': 20 },
      { 'garlic-knots': 18, fries: 20 },
      { 'philly-cheesesteak': 20, 'eggplant-parm-sub': 5 },
    ]
    const requests: GroupOrderRequest[] = [
      { people: 4 },
      { people: 8, vegetarians: 2 },
      { people: 20 },
      { people: 30, vegetarians: 10 },
      { people: 30, vegetarians: 10, preferences: { mains: 'subs' } },
      { people: 30, vegetarians: 10, preferences: { mains: 'mix', spicy: true } },
    ]
    for (const inCart of carts) {
      for (const request of requests) {
        const name = `${JSON.stringify(request)} with ${JSON.stringify(inCart)}`
        const result = planGroupOrder(request, inCart)
        if ('message' in result) throw new Error(`${name}: ${result.message}`)
        expect(addable(result.lines, inCart), name).toEqual({ lines: result.lines })
        expect(servings(result.lines.filter(isMain)), name).toBeGreaterThanOrEqual(request.people)
      }
    }
  })

  it('shares a category evenly over the kinds the line cap needs, whatever the cart holds', () => {
    // 30 drinks need two kinds at 20 a line: half each, with a soda in the cart or not.
    expect(plan({ people: 30, vegetarians: 10 }, { soda: 1 }).lines.filter(inCategory('drinks'))).toEqual([
      { id: 'soda', quantity: 15 },
      { id: 'lemonade', quantity: 15 },
    ])
    // With 6 sodas in the cart, the soda line takes 14, and lemonade the rest.
    expect(plan({ people: 30, vegetarians: 10 }, { soda: 6 }).lines.filter(inCategory('drinks'))).toEqual([
      { id: 'soda', quantity: 14 },
      { id: 'lemonade', quantity: 16 },
    ])
  })

  it('plans the same as for an empty cart when the cart leaves room for every line', () => {
    expect(plan({ people: 30, vegetarians: 10 }, { 'margherita-pizza-large': 2, fries: 1 })).toEqual(
      plan({ people: 30, vegetarians: 10 }),
    )
  })
})

describe("planGroupOrder's words come from the menu", () => {
  it("counts each main category with the noun menu.ts gives it, and says sides by their spoken names", () => {
    const pizza = mainCategories.find((category) => category.id === 'pizza')
    const subs = mainCategories.find((category) => category.id === 'subs')
    expect(pizza?.noun).toEqual(['pizza', 'pizzas'])
    expect(subs?.noun).toEqual(['sub', 'subs'])

    const knots = findItem('garlic-knots')
    if (!knots) throw new Error('No garlic knots on the menu')
    expect(knots.name).toBe('Garlic Knots (6)')
    expect(spokenName(knots)).toBe('garlic knots')
    expect(plan({ people: 20 }).summary).toContain('plus garlic knots and a drink each')
    expect(plan({ people: 1, preferences: { mains: 'subs', include: ['fries'] } }).summary).toBe('1 sub, plus fries and a drink')
  })

  it('plans mains, sides and drinks from the categories menu.ts gives those roles, and nothing else', () => {
    const planned = new Set(
      [plan({ people: 30, vegetarians: 10, preferences: { mains: 'mix', spicy: true } }), plan({ people: 12 })]
        .flatMap((result) => result.lines)
        .map(({ id }) => found(id).item.category),
    )
    const roles = new Map(categories.map((category) => [category.id as Category, 'plan' in category ? category.plan : undefined]))
    for (const category of planned) expect(roles.get(category), category).toBeDefined()
  })
})

describe('planGroupOrder with a budget', () => {
  /** What the lines cost, in cents, at menu prices. */
  function cost(lines: ItemQuantity[]): number {
    return lines.reduce((sum, line) => sum + found(line.id).variant.price * line.quantity, 0)
  }

  function planFor(request: GroupOrderRequest, orderType: 'pickup' | 'delivery'): GroupPlan {
    const result = planGroupOrder(request, {}, orderType)
    if ('message' in result) throw new Error(`No plan for ${JSON.stringify(request)}: ${result.message}`)
    return result
  }

  it('leaves the plan as it is when it fits, and says so', () => {
    const result = planFor({ people: 30, vegetarians: 10, budget: 300 }, 'pickup')
    const normal = plan({ people: 30, vegetarians: 10 })

    expect(result.lines).toEqual(normal.lines)
    expect(result.summary).toBe(normal.summary)
    expect(result.reason).toBe(`${normal.reason} Within your $300.00 budget.`)
    expect(result.budget).toBe("As it is, it's within the $300.00 budget.")
  })

  it("fits the owner's party of 30 into $250 with delivery: cheaper pizzas and sodas for 17, the same servings", () => {
    const result = planFor({ people: 30, vegetarians: 10, budget: 250 }, 'delivery')

    expect(result).toEqual({
      title: 'For your party of 30',
      reason: 'Mains for 32 (20 vegetarian), sides to share and drinks for 17. Within your $250.00 budget, delivery included.',
      summary: '8 large pizzas, 5 of them vegetarian, plus garlic knots and drinks for 17',
      lines: [
        { id: 'cheese-pizza-large', quantity: 2 },
        { id: 'pepperoni-pizza-large', quantity: 3 },
        { id: 'margherita-pizza-large', quantity: 1 },
        { id: 'white-pizza-large', quantity: 2 },
        { id: 'garlic-knots', quantity: 6 },
        { id: 'soda', quantity: 17 },
      ],
      budget: 'To stay within the $250.00 budget, delivery included: cheaper pizzas and drinks for 17 of the 30.',
    })
    expect(cost(result.lines) + DELIVERY_FEE).toBe(24818)
  })

  it('counts the delivery fee unless it is pickup, leaving room for it before the customer has said', () => {
    // The plan costs $297.56: within $300 for pickup, over it with the $3.99 fee.
    expect(planFor({ people: 30, vegetarians: 10, budget: 300 }, 'pickup').budget).toBe("As it is, it's within the $300.00 budget.")
    const delivery = planFor({ people: 30, vegetarians: 10, budget: 300 }, 'delivery')
    expect(delivery.budget).toMatch(/^To stay within the \$300\.00 budget, delivery included: /)
    expect(cost(delivery.lines) + DELIVERY_FEE).toBeLessThanOrEqual(30000)
    // Before the choice: so a plan made then still fits when they say delivery (review round 1).
    const notChosen = planGroupOrder({ people: 30, vegetarians: 10, budget: 300 })
    if ('message' in notChosen) throw new Error(notChosen.message)
    expect(notChosen.lines).toEqual(delivery.lines)
    expect(notChosen.budget).toMatch(/^To stay within the \$300\.00 budget, leaving room for delivery: /)
    expect(notChosen.reason).toMatch(/ Within your \$300\.00 budget, leaving room for delivery\.$/)
  })

  it("cuts in the owner's order: cheapest drink, cheaper mains, fewer drinks, then fewer sides, never the mains", () => {
    const normal = plan({ people: 30, vegetarians: 10 })
    const sides = (lines: ItemQuantity[]) => count(lines.filter(inCategory('sides')))
    const drinks = (lines: ItemQuantity[]) => count(lines.filter(inCategory('drinks')))

    for (let dollars = 170; dollars <= 310; dollars += 5) {
      const label = `a $${dollars} budget`
      const result = planGroupOrder({ people: 30, vegetarians: 10, budget: dollars }, {}, 'delivery')
      if ('message' in result) throw new Error(`No plan for ${label}: ${result.message}`)
      const mains = result.lines.filter(isMain)

      expect(cost(result.lines) + DELIVERY_FEE, label).toBeLessThanOrEqual(dollars * 100)
      expect(servings(mains), label).toBe(servings(normal.lines.filter(isMain)))
      expect(servings(mains.filter(isVegetarian)), label).toBeGreaterThanOrEqual(10)
      // Sides go only once the drinks have all gone.
      if (sides(result.lines) < sides(normal.lines)) expect(drinks(result.lines), label).toBe(0)
      // Fewer drinks than one each are the cheapest drink, as many as a line holds, then the next.
      const drinkCount = drinks(result.lines)
      if (drinkCount > 0 && drinkCount < 30) {
        const sodas = Math.min(drinkCount, MAX_LINE_QUANTITY)
        expect(result.lines.filter(inCategory('drinks')), label).toEqual([
          { id: 'soda', quantity: sodas },
          ...(drinkCount > sodas ? [{ id: 'lemonade', quantity: drinkCount - sodas }] : []),
        ])
      }
    }
  })

  it('takes the cheapest drink as far as a line holds before the next, when that is enough', () => {
    // The normal plan's 15 sodas and 15 lemonades cost $89.70; 20 sodas and 10 lemonades, $84.70.
    const normal = plan({ people: 30, vegetarians: 10 })
    const result = planFor({ people: 30, vegetarians: 10, budget: (cost(normal.lines) - 400) / 100 }, 'pickup')

    expect(result.lines.filter(inCategory('drinks'))).toEqual([
      { id: 'soda', quantity: 20 },
      { id: 'lemonade', quantity: 10 },
    ])
    expect(result.lines.filter(isMain)).toEqual(normal.lines.filter(isMain))
    expect(result.budget).toBe('To stay within the $293.56 budget: cheaper drinks.')
  })

  it('keeps what the customer asked for by name, however tight the budget', () => {
    const result = planFor({ people: 10, budget: 70, preferences: { include: ['fries', 'lemonade'] } }, 'pickup')
    const ids = result.lines.map(({ id }) => id)

    expect(ids).toContain('fries')
    expect(ids).toContain('lemonade')
    expect(cost(result.lines)).toBeLessThanOrEqual(7000)
  })

  it('plans without drinks when they said no drinks, cutting only mains kinds and sides', () => {
    const result = planFor({ people: 30, vegetarians: 10, budget: 200, preferences: { drinks: false } }, 'delivery')

    expect(result.lines.filter(inCategory('drinks'))).toEqual([])
    expect(result.budget).not.toContain('drinks')
    expect(cost(result.lines) + DELIVERY_FEE).toBeLessThanOrEqual(20000)
  })

  it('says the least a plan can cost when the budget is under it, counting the fee for delivery', () => {
    // The cheapest 8 large pizzas that still give the vegetarians 3, $165.92, and the fee.
    expect(planGroupOrder({ people: 30, vegetarians: 10, budget: 150 }, {}, 'delivery')).toEqual({
      message:
        "That's under what feeding 30 can cost: the least is $169.91 with delivery (one hundred sixty-nine dollars and ninety-one cents), with the cheapest pizzas and no other sides or drinks. Tell the customer, and ask whether that works: if it does, call plan_group_order again with budget 169.91; if not, plan without the budget.",
    })
    expect(planGroupOrder({ people: 4, budget: 30 }, {}, 'pickup')).toEqual({
      message:
        "That's under what feeding 4 can cost: the least is $33.98 (thirty-three ninety-eight), with the cheapest pizzas and no other sides or drinks. Tell the customer, and ask whether that works: if it does, call plan_group_order again with budget 33.98; if not, plan without the budget.",
    })
    // That budget gets the leanest plan, at exactly the least.
    const leanest = planGroupOrder({ people: 30, vegetarians: 10, budget: 169.91 }, {}, 'delivery')
    if ('message' in leanest) throw new Error(leanest.message)
    expect(cost(leanest.lines) + DELIVERY_FEE).toBe(16991)
  })

  it('turns down a budget that is not an amount, and takes null as none', () => {
    const bad = 'budget has to be the most they want to spend, in dollars above zero, such as 250.'
    expect(message({ people: 20, budget: 0 })).toBe(bad)
    expect(message({ people: 20, budget: -5 })).toBe(bad)
    expect(planGroupOrder({ people: 20, budget: '250' })).toEqual({ message: bad })
    expect(planGroupOrder({ people: 20, budget: null })).toEqual(plan({ people: 20 }))
  })
})
