import { describe, expect, it } from 'vitest'
import type { Suggestions } from './handlers'
import { sameSuggestions } from './MenuUiProvider'

// The card plan_group_order shows, with the planner's own title and reason.
const plan: Suggestions = {
  title: 'Party of 20',
  reason: 'Mains for 20, sides to share and a drink each.',
  lines: [
    { id: 'pepperoni-pizza-large', name: 'Large Pepperoni Pizza', quantity: 2, total: '$41.98' },
    { id: 'soda', name: 'Fountain Soda', quantity: 20, total: '$49.80' },
  ],
  total: '$91.78',
}

describe('sameSuggestions', () => {
  // The call the agent makes in real runs: the same lines, its own title, no reason.
  it("is the same card when the agent re-shows the plan's lines with its own title and no reason", () => {
    const reShown: Suggestions = { title: 'Party of 20 plan', lines: [...plan.lines].reverse(), total: plan.total }
    expect(sameSuggestions(plan, reShown)).toBe(true)
  })

  it('is a new card when a quantity or a line differs', () => {
    expect(sameSuggestions(plan, { ...plan, lines: [{ ...plan.lines[0], quantity: 3 }, plan.lines[1]] })).toBe(false)
    expect(sameSuggestions(plan, { ...plan, lines: [plan.lines[0]] })).toBe(false)
    expect(
      sameSuggestions(plan, {
        ...plan,
        lines: [plan.lines[0], { id: 'lemonade', name: 'Fresh Lemonade', quantity: 20, total: '$59.80' }],
      }),
    ).toBe(false)
  })
})
