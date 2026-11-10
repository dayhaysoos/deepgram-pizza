// What the voice tools change on the menu page, besides the cart: the menu
// cards find_menu_items lights up, and the suggestion card show_suggestions
// opens. The page reads this state; the tool handlers (ToolHandlersProvider.tsx) and
// the page's own controls change it.

import { createContext, useContext, useMemo, useState, type ReactNode } from 'react'
import type { Suggestions } from './handlers'

/** The suggestions on screen. `key` is new for every card, so a replaced card starts fresh. */
export type ShownSuggestions = { key: number; suggestions: Suggestions }

export type MenuUi = {
  /** Item ids of the highlighted menu cards, in the order find_menu_items found them. */
  highlighted: readonly string[]
  /** What the suggestion card shows now, or null when it's closed. */
  shown: ShownSuggestions | null
  /** Highlights these menu cards, replacing any highlighted before. */
  highlight(itemIds: readonly string[]): void
  clearHighlight(): void
  /** Opens the suggestion card, replacing any card already open. */
  showSuggestions(suggestions: Suggestions): void
  closeSuggestions(): void
}

const NONE: readonly string[] = []

const MenuUiContext = createContext<MenuUi | null>(null)

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

export function useMenuUi(): MenuUi {
  const menuUi = useContext(MenuUiContext)
  if (!menuUi) throw new Error('useMenuUi needs a <MenuUiProvider> above it.')
  return menuUi
}
