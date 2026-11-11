import { describe, expect, it } from 'vitest'
import type { Suggestions } from './handlers'
import { sameSuggestions } from './MenuUiProvider'

const plan: Suggestions = {
  title: 'Party of 20',
  reason: 'Five large pizzas, garlic knots and a drink each',
  lines: [
    { id: 'pepperoni-pizza-large', name: 'Large Pepperoni Pizza', quantity: 2, total: '$41.98' },
    { id: 'soda', name: 'Fountain Soda', quantity: 20, total: '$49.80' },
  ],
  total: '$91.78',
}

describe('sameSuggestions', () => {
  it('is the same card when the title, reason and lines match', () => {
    expect(sameSuggestions(plan, { ...plan, lines: plan.lines.map((line) => ({ ...line })) })).toBe(true)
  })

  it('is a new card when a quantity, a line, the title or the reason differs', () => {
    expect(sameSuggestions(plan, { ...plan, lines: [{ ...plan.lines[0], quantity: 3 }, plan.lines[1]] })).toBe(false)
    expect(sameSuggestions(plan, { ...plan, lines: [plan.lines[0]] })).toBe(false)
    expect(sameSuggestions(plan, { ...plan, title: 'Party of 21' })).toBe(false)
    expect(sameSuggestions(plan, { ...plan, reason: undefined })).toBe(false)
  })
})
