// What the voice tools change on the menu page, besides the cart: the menu
// cards find_menu_items lights up, and the suggestion card show_suggestions
// opens. The page reads this state with useMenuUi() (src/pageContext.ts); the
// tool handlers (ToolHandlersProvider.tsx) and the page's own controls change it.

import { useMemo, useState, type ReactNode } from 'react'
import { MenuUiContext, type ShownSuggestions } from '../pageContext'
import type { Suggestions } from './handlers'

const NONE: readonly string[] = []

export function MenuUiProvider({ children }: { children: ReactNode }) {
  const [highlighted, setHighlighted] = useState(NONE)
  const [shown, setShown] = useState<ShownSuggestions | null>(null)

  // Created once, so the tool handlers can hold on to them for the page's lifetime.
  const [actions] = useState(() => ({
    highlight: (itemIds: readonly string[]) => setHighlighted(itemIds.length > 0 ? itemIds : NONE),
    clearHighlight: () => setHighlighted(NONE),
    showSuggestions: (suggestions: Suggestions) => setShown((before) => ({ key: (before?.key ?? 0) + 1, suggestions })),
    closeSuggestions: () => setShown(null),
  }))

  const value = useMemo(() => ({ highlighted, shown, ...actions }), [highlighted, shown, actions])
  return <MenuUiContext value={value}>{children}</MenuUiContext>
}
