import { describe, expect, it } from 'vitest'
import { menu, type MenuItem } from './menu/menu'
import { largestVariant } from './shop'

function item(id: string): MenuItem {
  const found = menu.find((i) => i.id === id)
  if (!found) throw new Error(`No menu item ${id}`)
  return found
}

describe('largestVariant', () => {
  it('picks Large for a pizza', () => {
    expect(largestVariant(item('margherita-pizza')).id).toBe('margherita-pizza-large')
  })

  it('picks 12 pc for wings', () => {
    expect(largestVariant(item('buffalo-wings')).id).toBe('buffalo-wings-12pc')
  })

  it('returns the only variant of a single-size item', () => {
    expect(largestVariant(item('fries')).id).toBe('fries')
  })

  it('does not depend on the order of the variants', () => {
    const pizza = item('cheese-pizza')
    const reversed = { ...pizza, variants: [...pizza.variants].reverse() }

    expect(largestVariant(reversed).id).toBe('cheese-pizza-large')
  })
})
