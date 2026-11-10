// Telling the agent about cart changes the customer makes by tapping, so it
// never answers from a stale cart (SPEC.md, "The agent always works from the
// current cart"). Every tap that changes the cart calls `reportTap(change)`
// right after its cart action. The update's text goes to the sink: nowhere by
// default, to the agent while a voice session is open, or to a log in dev tools.

import { createContext, useCallback, useContext, useLayoutEffect, useRef, type ReactNode } from 'react'
import { useShoppingCart } from 'use-shopping-cart'
import { applyCartChange, quantitiesOf, summarizeCart, type CartChange } from './cartSummary'
import { describeTapChange } from './tapUpdates'

/** Receives each update's text: "Customer added 1 × Fries by tapping. Cart: …". */
export type TapUpdateSink = (text: string) => void

/**
 * Where tap updates go. Provide one above `TapUpdatesProvider` to receive them;
 * with none, they go nowhere, since there's no agent to tell.
 */
export const TapUpdateSinkContext = createContext<TapUpdateSink>(() => {})

type ReportTap = (change: CartChange) => void

const ReportTapContext = createContext<ReportTap | null>(null)

/**
 * Gives the components below `useReportTap()`. The cart is read here, once, so
 * menu cards that report a tap don't re-render on every cart change.
 */
export function TapUpdatesProvider({ children }: { children: ReactNode }) {
  const sink = useContext(TapUpdateSinkContext)
  const cartDetails = useShoppingCart((cart) => cart.cartDetails)

  const latest = useRef({ sink, cartDetails })
  useLayoutEffect(() => {
    latest.current = { sink, cartDetails }
  }, [sink, cartDetails])

  // The cart action that just ran shows up only after the next render, so the
  // cart here is the one from before the tap, and the change is applied to it.
  const reportTap = useCallback<ReportTap>((change) => {
    const { sink, cartDetails } = latest.current
    sink(describeTapChange(change, summarizeCart(applyCartChange(quantitiesOf(cartDetails), change))))
  }, [])

  return <ReportTapContext value={reportTap}>{children}</ReportTapContext>
}

/** Reports a tap that changed the cart. Call it right after the cart action, in the same handler. */
export function useReportTap(): ReportTap {
  const reportTap = useContext(ReportTapContext)
  if (!reportTap) throw new Error('useReportTap needs a <TapUpdatesProvider> above it.')
  return reportTap
}
