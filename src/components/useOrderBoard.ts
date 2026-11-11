// The order board (orderBoard.ts), wired to the page: one board per page,
// hearing every change from the page's cart changes, and what the cart drawer
// and the phone strip show from it.

import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { useShoppingCart } from 'use-shopping-cart'
import { quantitiesOf, summarizeCart, type DeliveryCharge } from '../agent/cartSummary'
import { useCartChanges, useOrderType, useVoiceSession } from '../pageContext'
import { boardLines, createOrderBoard, EMPTY_BOARD, type BoardLine, type LatestLine, type OrderBoard } from './orderBoard'

/**
 * The page's board, made once and subscribed to the page's cart changes, with
 * the voice session's handle, so what the agent adds keys in as it reads it
 * back. MenuLayout makes it without reading it, so the menu doesn't re-render
 * as lines key in; the drawer and the strip read it with useOrderBoardView.
 */
export function useOrderBoardStore(): OrderBoard {
  const cartChanges = useCartChanges()
  const voice = useVoiceSession()
  const [board] = useState(() => createOrderBoard(voice))
  useEffect(() => cartChanges.subscribe(board.cartChanged), [cartChanges, board])
  return board
}

/** What the board shows now. */
export type OrderBoardView = {
  /** The lines, as the board shows them: keyed in so far, with the ones on their way out. */
  lines: BoardLine[]
  /** Whether a line is in, not on its way out: the total and Checkout show only then. */
  anyKeyedIn: boolean
  /** The last line keyed in, changed or taken out, if the page has changed the cart. */
  latest: LatestLine | null
  /** For delivery, the fee and the cart's total with it. */
  delivery?: DeliveryCharge
  /** What Checkout charges for the cart: its total, with the fee for delivery. It doesn't wait for lines to key in. */
  toPay: string
}

/** The board as it is now, for this cart and pickup or delivery. Re-renders as lines key in. */
export function useOrderBoardView(board: OrderBoard): OrderBoardView {
  const state = useSyncExternalStore(board.subscribe, board.getSnapshot, serverBoard)
  const cartDetails = useShoppingCart((cart) => cart.cartDetails)
  const orderType = useOrderType()
  return useMemo(() => {
    const cart = quantitiesOf(cartDetails)
    const lines = boardLines(state, cart)
    // The cart's total, the same figures the agent says and Stripe charges (summarizeCart),
    // so Checkout never charges more than the board shows, even while lines key in.
    const { total, delivery } = summarizeCart(cart, orderType)
    return {
      lines,
      anyKeyedIn: lines.some(({ mark }) => mark !== 'leaving'),
      latest: state.latest,
      ...(delivery && { delivery }),
      toPay: delivery ? delivery.totalWithDelivery : total,
    }
  }, [state, cartDetails, orderType])
}

/** The server renders the cart as it is, with nothing keying in. */
function serverBoard() {
  return EMPTY_BOARD
}
