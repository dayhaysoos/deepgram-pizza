// What the voice tools change on the menu page, besides the cart: the menu
// cards find_menu_items lights up, and the suggestion card show_suggestions
// opens. The page reads this state with useMenuUi() (src/pageContext.ts); the
// tool handlers (ToolHandlersProvider.tsx) and the page's own controls change it.

import { useMemo, useState, type ReactNode } from 'react'
import { MenuUiContext, type ShownSuggestions } from '../pageContext'
import type { Suggestions } from './handlers'

const NONE: readonly string[] = []

/** The same card: the same items in the same quantities, in any order. Titles and reasons aren't compared. */
export function sameSuggestions(a: Suggestions, b: Suggestions): boolean {
  if (a.lines.length !== b.lines.length) return false
  const quantities = new Map(a.lines.map((line) => [line.id, line.quantity]))
  return b.lines.every((line) => quantities.get(line.id) === line.quantity)
}

export function MenuUiProvider({ children }: { children: ReactNode }) {
  const [highlighted, setHighlighted] = useState(NONE)
  const [shown, setShown] = useState<ShownSuggestions | null>(null)

  // Created once, so the tool handlers can hold on to them for the page's lifetime.
  const [actions] = useState(() => ({
    highlight: (itemIds: readonly string[]) => setHighlighted(itemIds.length > 0 ? itemIds : NONE),
    clearHighlight: () => setHighlighted(NONE),
    // The agent sometimes shows the plan plan_group_order just put on the card
    // again, with its own title and no reason (it never sees the card's). Same
    // lines means the same card: it stays as it is, reason and all.
    showSuggestions: (suggestions: Suggestions) =>
      setShown((before) => (before && sameSuggestions(before.suggestions, suggestions) ? before : { key: (before?.key ?? 0) + 1, suggestions })),
    closeSuggestions: () => setShown(null),
  }))

  const value = useMemo(() => ({ highlighted, shown, ...actions }), [highlighted, shown, actions])
  return <MenuUiContext value={value}>{children}</MenuUiContext>
}
