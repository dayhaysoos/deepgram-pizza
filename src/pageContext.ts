// What the menu page's parts share through React context, and the hooks that
// read it: the voice session's handle, what the voice tools change on screen,
// pickup or delivery, the page's cart changes and its tool handlers. Each is
// provided once, near the top of MenuPage (MenuPage.tsx says where), and the
// parts below read it wherever they are.
//
// The contexts live here, apart from their providers, so this module imports
// nothing but types. That keeps src/agent/ and src/voice/ from importing each
// other: the cart changes and the tool handlers reach the voice session
// through useVoiceSession(), and the voice session reaches the tool handlers
// through useToolHandlers(). It also means hot-reloading a provider's module
// in `pnpm dev` doesn't make a new context that the components already on the
// page can't read.

import { createContext, useContext, useSyncExternalStore } from 'react'
import type { CartChanges } from './agent/cartChanges'
import type { Suggestions, ToolHandlers } from './agent/handlers'
import type { OrderTypeStore } from './agent/orderType'
import type { OrderType } from './shop'
import type { PromptTarget, SessionHandle } from './voice/sessionHandle'
import type { SessionEvent, SessionState } from './voice/sessionStatus'

/** What the voice session's own parts (VoiceSession.tsx) need to run it. */
export type VoiceSessionControls = {
  state: SessionState
  /** Passes an event to the session's reducer (sessionStatus.ts). */
  send: (event: SessionEvent) => void
  /** Hands the live session's AgentSession to the handle. Returns the function to call when it's gone. */
  attach: (agent: PromptTarget) => () => void
}

/** Provided by VoiceSessionProvider (VoiceSession.tsx). */
export const VoiceSessionControlsContext = createContext<VoiceSessionControls | null>(null)

/** Provided by VoiceSessionProvider (VoiceSession.tsx). */
export const VoiceHandleContext = createContext<SessionHandle | null>(null)

/** The suggestions on screen. `key` is new for every card, so a replaced card starts fresh. */
export type ShownSuggestions = { key: number; suggestions: Suggestions }

/** What the voice tools change on the menu page, besides the cart. */
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
  /** Whether a suggestion card is open now, read at the moment of the call (the tool handlers outlive renders). */
  isShowingSuggestions(): boolean
}

/** Provided by MenuUiProvider (src/agent/MenuUiProvider.tsx). */
export const MenuUiContext = createContext<MenuUi | null>(null)

/** Provided by OrderTypeProvider (src/agent/OrderTypeProvider.tsx). */
export const OrderTypeContext = createContext<OrderTypeStore | null>(null)

/** Provided by CartChangesProvider (src/agent/CartChangesProvider.tsx). */
export const CartChangesContext = createContext<CartChanges | null>(null)

/** Provided by ToolHandlersProvider (src/agent/ToolHandlersProvider.tsx). */
export const ToolHandlersContext = createContext<ToolHandlers | null>(null)

/** Receives the text of each tap update: "Customer added 1 × Fries by tapping. Cart: …". */
export type TapUpdateSink = (text: string) => void

/**
 * Also hears each tap update, besides the voice agent. Provide one above
 * MenuPage to see them, as the dev tools panel does; by default, nothing does.
 */
export const TapUpdateSinkContext = createContext<TapUpdateSink>(() => {})

/** The voice session's state, and how VoiceSession.tsx runs it. */
export function useVoiceSessionControls(): VoiceSessionControls {
  return required(useContext(VoiceSessionControlsContext), 'useVoiceSessionControls', 'VoiceSessionProvider')
}

/**
 * The page's handle on the voice session: `tell(text)` and
 * `leaveAfterSpeaking()`, safe to call whether or not a session is on. It's
 * the same object for the page's lifetime.
 */
export function useVoiceSession(): SessionHandle {
  return required(useContext(VoiceHandleContext), 'useVoiceSession', 'VoiceSessionProvider')
}

/** The highlighted menu cards and the suggestion card, and what changes them. */
export function useMenuUi(): MenuUi {
  return required(useContext(MenuUiContext), 'useMenuUi', 'MenuUiProvider')
}

/**
 * The page's pickup-or-delivery store (src/agent/orderType.ts), the same object
 * for the page's lifetime: `get()` reads the choice at the moment it's called,
 * for code that outlives renders (the tool handlers, the talk button's press).
 */
export function useOrderTypeStore(): OrderTypeStore {
  return required(useContext(OrderTypeContext), 'useOrderTypeStore', 'OrderTypeProvider')
}

/**
 * Pickup or delivery, or null before the customer has chosen. Re-renders when
 * it changes. Null while the page hydrates, as the server rendered it, then
 * the choice saved in the browser.
 */
export function useOrderType(): OrderType | null {
  const store = useOrderTypeStore()
  return useSyncExternalStore(store.subscribe, store.get, serverOrderType)
}

/** The server has no saved choice. */
function serverOrderType(): OrderType | null {
  return null
}

/**
 * The page's cart changes: a tap calls `tap({ type: 'add', lines: [{ id: 'fries', quantity: 1 }] })`
 * instead of a use-shopping-cart action, so the agent hears about it.
 */
export function useCartChanges(): CartChanges {
  return required(useContext(CartChangesContext), 'useCartChanges', 'CartChangesProvider')
}

/** The page's tool handlers: `await handlers.add_item({ id: 'fries', quantity: 1 })`. */
export function useToolHandlers(): ToolHandlers {
  return required(useContext(ToolHandlersContext), 'useToolHandlers', 'ToolHandlersProvider')
}

function required<Value>(value: Value | null, hook: string, provider: string): Value {
  if (value === null) throw new Error(`${hook} needs a <${provider}> above it.`)
  return value
}
