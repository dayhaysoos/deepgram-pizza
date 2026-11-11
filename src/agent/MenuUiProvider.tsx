// What the voice tools change on the menu page, besides the cart: the menu
// cards find_menu_items lights up, and the suggestion card show_suggestions
// opens. The page reads this state with useMenuUi() (src/pageContext.ts); the
// tool handlers (ToolHandlersProvider.tsx) and the page's own controls change it.
//
// The card and the highlights come up with the agent's voice, not before it
// (`showWithVoice` on the voice session's handle): the owner found the card
// popping up in silence, a couple of seconds before the agent spoke,
// disjointed (2026-11-11). With no session they come up at once. The cart
// itself changes at once (its state, the badge, the total); what the order
// board keys in, and the drawer opening, follow the voice the same way
// (src/components/orderBoard.ts, ToolHandlersProvider.tsx).

import { useMemo, useRef, useState, type ReactNode } from 'react'
import { MenuUiContext, useVoiceSession, type ShownSuggestions } from '../pageContext'
import type { Suggestions } from './handlers'

const NONE: readonly string[] = []

/** Goes inside `VoiceSessionProvider`. */
export function MenuUiProvider({ children }: { children: ReactNode }) {
  const voice = useVoiceSession()
  const [highlighted, setHighlighted] = useState(NONE)
  const [shown, setShown] = useState<ShownSuggestions | null>(null)
  // Whether a card is open now, for the tool handlers, which outlive any one
  // render: from showSuggestions, even while the card waits for the voice,
  // until closeSuggestions. Only those two actions change it.
  const showing = useRef(false)

  // Created once, so the tool handlers can hold on to them for the page's lifetime.
  const [actions] = useState(() => {
    // What's waiting for the voice; a newer card or highlight replaces it.
    let cancelCard = () => {}
    let cancelHighlight = () => {}
    return {
      highlight: (itemIds: readonly string[]) => {
        cancelHighlight()
        if (itemIds.length === 0) return setHighlighted(NONE)
        cancelHighlight = voice.showWithVoice(() => setHighlighted(itemIds))
      },
      clearHighlight: () => {
        cancelHighlight()
        setHighlighted(NONE)
      },
      showSuggestions: (suggestions: Suggestions) => {
        showing.current = true
        cancelCard()
        cancelCard = voice.showWithVoice(() => setShown((before) => ({ key: (before?.key ?? 0) + 1, suggestions })))
      },
      closeSuggestions: () => {
        showing.current = false
        cancelCard()
        setShown(null)
      },
      isShowingSuggestions: () => showing.current,
    }
  })

  const value = useMemo(() => ({ highlighted, shown, ...actions }), [highlighted, shown, actions])
  return <MenuUiContext value={value}>{children}</MenuUiContext>
}
