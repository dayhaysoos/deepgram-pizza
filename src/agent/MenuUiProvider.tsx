// What the voice tools change on the menu page, besides the cart: the menu
// cards find_menu_items lights up, and the suggestion card show_suggestions
// opens. The page reads this state; the tool handlers (useToolHandlers.tsx) and
// the page's own controls change it.

import { createContext, useContext, useMemo, useState, type ReactNode } from 'react'
import type { SuggestionCard } from './handlers'

/** The suggestion card on screen. `key` is new for every card, so a replaced card starts fresh. */
export type ShownSuggestion = { key: number; card: SuggestionCard }

export type MenuUi = {
  /** Item ids of the highlighted menu cards, in the order find_menu_items found them. */
  highlighted: readonly string[]
  suggestion: ShownSuggestion | null
  /** Highlights these menu cards, replacing any highlighted before. */
  highlight(itemIds: readonly string[]): void
  clearHighlight(): void
  /** Opens the suggestion card, replacing any card already open. */
  showSuggestions(card: SuggestionCard): void
  closeSuggestions(): void
}

const NONE: readonly string[] = []

const MenuUiContext = createContext<MenuUi | null>(null)

export function MenuUiProvider({ children }: { children: ReactNode }) {
  const [highlighted, setHighlighted] = useState(NONE)
  const [suggestion, setSuggestion] = useState<ShownSuggestion | null>(null)

  // Created once, so the tool handlers can hold on to them for the page's lifetime.
  const [actions] = useState(() => ({
    highlight: (itemIds: readonly string[]) => setHighlighted(itemIds.length > 0 ? itemIds : NONE),
    clearHighlight: () => setHighlighted(NONE),
    showSuggestions: (card: SuggestionCard) => setSuggestion((shown) => ({ key: (shown?.key ?? 0) + 1, card })),
    closeSuggestions: () => setSuggestion(null),
  }))

  const value = useMemo(() => ({ highlighted, suggestion, ...actions }), [highlighted, suggestion, actions])
  return <MenuUiContext value={value}>{children}</MenuUiContext>
}

export function useMenuUi(): MenuUi {
  const menuUi = useContext(MenuUiContext)
  if (!menuUi) throw new Error('useMenuUi needs a <MenuUiProvider> above it.')
  return menuUi
}
