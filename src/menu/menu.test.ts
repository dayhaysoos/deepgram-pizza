import { describe, expect, it } from 'vitest'
import {
  categories,
  defaultVariant,
  findVariant,
  formatPrice,
  imagePath,
  menu,
  menuToProducts,
  productFor,
  products,
  tags,
  type MenuItem,
} from './menu'

// These rules hold for any shop's menu. If you edit menu.json and one fails,
// the failure lists the item or variant ids that break the rule.

const itemIds = menu.map((item) => item.id)
const allVariants = menu.flatMap((item) => item.variants)

function duplicates(values: string[]) {
  return values.filter((value, index) => values.indexOf(value) !== index)
}

describe('menu.json', () => {
  it('gives every item the MenuItem fields, and nothing else', () => {
    const itemKeys = ['category', 'description', 'id', 'name', 'pairsWith', 'tags', 'variants']
    const variantKeys = ['id', 'label', 'price', 'serves']

    const wrongItems = menu.filter(
      (item) =>
        JSON.stringify(Object.keys(item).sort()) !== JSON.stringify(itemKeys) ||
        typeof item.id !== 'string' ||
        item.id === '' ||
        typeof item.name !== 'string' ||
        item.name === '' ||
        typeof item.description !== 'string' ||
        item.description === '' ||
        !Array.isArray(item.tags) ||
        !Array.isArray(item.variants) ||
        !Array.isArray(item.pairsWith),
    )
    const wrongVariants = allVariants.filter(
      (variant) =>
        Object.keys(variant).some((key) => !variantKeys.includes(key)) ||
        typeof variant.id !== 'string' ||
        variant.id === '' ||
        (variant.label !== undefined && typeof variant.label !== 'string'),
    )

    expect(wrongItems.map((item) => item.id)).toEqual([])
    expect(wrongVariants.map((variant) => variant.id)).toEqual([])
  })

  it('has unique item ids', () => {
    expect(duplicates(itemIds)).toEqual([])
  })

  it('has unique variant ids across the whole menu', () => {
    expect(duplicates(allVariants.map((variant) => variant.id))).toEqual([])
  })

  it('uses only the categories listed in menu.ts', () => {
    const allowed = categories.map((category) => category.id as string)

    expect(duplicates(allowed)).toEqual([])
    expect(menu.filter((item) => !allowed.includes(item.category)).map((item) => item.id)).toEqual([])
  })

  it('uses only the tags listed in menu.ts', () => {
    const allowed = tags as string[]

    expect(
      menu.filter((item) => item.tags.some((tag) => !allowed.includes(tag))).map((item) => item.id),
    ).toEqual([])
  })

  it('gives every item at least one variant', () => {
    expect(menu.filter((item) => item.variants.length === 0).map((item) => item.id)).toEqual([])
  })

  it('gives a single-size item one variant with the item id and no label', () => {
    const wrong = menu.filter(
      (item) =>
        item.variants.length === 1 &&
        (item.variants[0].id !== item.id || item.variants[0].label !== undefined),
    )

    expect(wrong.map((item) => item.id)).toEqual([])
  })

  it('gives each variant of a sized item an id of <item-id>-<size> and a label', () => {
    const wrong = menu
      .filter((item) => item.variants.length > 1)
      .flatMap((item) =>
        item.variants.filter(
          (variant) =>
            !variant.id.startsWith(`${item.id}-`) ||
            variant.id.length <= item.id.length + 1 ||
            !variant.label,
        ),
      )

    expect(wrong.map((variant) => variant.id)).toEqual([])
  })

  it('prices every variant as a positive whole number of cents', () => {
    const wrong = allVariants.filter(
      (variant) => !Number.isInteger(variant.price) || variant.price <= 0,
    )

    expect(wrong.map((variant) => variant.id)).toEqual([])
  })

  it('says every variant serves at least one person', () => {
    const wrong = allVariants.filter(
      (variant) => !Number.isInteger(variant.serves) || variant.serves < 1,
    )

    expect(wrong.map((variant) => variant.id)).toEqual([])
  })

  it('pairs items only with other items that exist', () => {
    const wrong = menu.flatMap((item) =>
      item.pairsWith
        .filter((id) => id === item.id || !itemIds.includes(id))
        .map((id) => `${item.id} -> ${id}`),
    )

    expect(wrong).toEqual([])
  })
})

const fixture: MenuItem[] = [
  {
    id: 'calzone',
    name: 'Calzone',
    category: 'pizza',
    description: 'Folded and baked.',
    tags: [],
    variants: [
      { id: 'calzone-small', label: 'Small', price: 900, serves: 1 },
      { id: 'calzone-big', label: 'Big', price: 1500, serves: 2 },
    ],
    pairsWith: ['water'],
  },
  {
    id: 'water',
    name: 'Water',
    category: 'drinks',
    description: 'Still.',
    tags: ['vegan'],
    variants: [{ id: 'water', price: 150, serves: 1 }],
    pairsWith: [],
  },
]

describe('productFor', () => {
  it('puts the size in front of the name of a sized item', () => {
    const [calzone] = fixture

    expect(productFor(calzone, calzone.variants[1])).toStrictEqual({
      id: 'calzone-big',
      name: 'Big Calzone',
      price: 1500,
      currency: 'USD',
    })
  })

  it('uses the item name alone for a single-size item', () => {
    const water = fixture[1]

    expect(productFor(water, water.variants[0])).toStrictEqual({
      id: 'water',
      name: 'Water',
      price: 150,
      currency: 'USD',
    })
  })
})

describe('menuToProducts', () => {
  it('makes one product per variant, with the size in the name of sized items', () => {
    expect(menuToProducts(fixture)).toStrictEqual([
      { id: 'calzone-small', name: 'Small Calzone', price: 900, currency: 'USD' },
      { id: 'calzone-big', name: 'Big Calzone', price: 1500, currency: 'USD' },
      { id: 'water', name: 'Water', price: 150, currency: 'USD' },
    ])
  })

  it('returns an empty list for an empty menu', () => {
    expect(menuToProducts([])).toStrictEqual([])
  })
})

describe('products', () => {
  it('has one product per variant of the menu, in menu order', () => {
    expect(products.map((product) => product.id)).toEqual(allVariants.map((variant) => variant.id))
  })
})

describe('findVariant', () => {
  it('finds every variant of the menu along with its item and the product the cart uses', () => {
    for (const item of menu) {
      for (const variant of item.variants) {
        const product = products.find((p) => p.id === variant.id)

        expect(findVariant(variant.id)).toEqual({ item, variant, product })
      }
    }
  })

  it('returns undefined for an id that is not on the menu', () => {
    expect(findVariant('not-on-the-menu')).toBeUndefined()
  })

  it('returns undefined for a sized item id without a size', () => {
    for (const item of menu.filter((item) => item.variants.length > 1)) {
      expect(findVariant(item.id)).toBeUndefined()
    }
  })
})

describe('defaultVariant', () => {
  const [calzone, water] = fixture

  it('picks the variant that serves the most people', () => {
    expect(defaultVariant(calzone).id).toBe('calzone-big')
  })

  it('does not depend on the order of the variants', () => {
    const reversed = { ...calzone, variants: [...calzone.variants].reverse() }

    expect(defaultVariant(reversed).id).toBe('calzone-big')
  })

  it('keeps the first one listed when two serve the same number', () => {
    const tied: MenuItem = {
      ...calzone,
      variants: [
        { id: 'calzone-classic', label: 'Classic', price: 1400, serves: 2 },
        { id: 'calzone-big', label: 'Big', price: 1500, serves: 2 },
      ],
    }

    expect(defaultVariant(tied).id).toBe('calzone-classic')
  })

  it('returns the only variant of a single-size item', () => {
    expect(defaultVariant(water).id).toBe('water')
  })
})

describe('imagePath', () => {
  it('points at the photo named after the item id', () => {
    expect(imagePath(fixture[0])).toBe('/images/calzone.jpg')
  })
})

describe('formatPrice', () => {
  it('formats cents as US dollars', () => {
    expect(formatPrice(2099)).toBe('$20.99')
    expect(formatPrice(249)).toBe('$2.49')
    expect(formatPrice(0)).toBe('$0.00')
    expect(formatPrice(150000)).toBe('$1,500.00')
  })
})
