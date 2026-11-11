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
  /** The last line keyed in, changed or taken out, if the page has changed the cart. */
  latest: LatestLine | null
  /** What the lines keyed in so far cost, written, with the delivery fee for delivery. */
  total: string
  delivery?: DeliveryCharge
}

/** The board as it is now, for this cart and pickup or delivery. Re-renders as lines key in. */
export function useOrderBoardView(board: OrderBoard): OrderBoardView {
  const state = useSyncExternalStore(board.subscribe, board.getSnapshot, serverBoard)
  const cartDetails = useShoppingCart((cart) => cart.cartDetails)
  const orderType = useOrderType()
  return useMemo(() => {
    const lines = boardLines(state, quantitiesOf(cartDetails))
    // The total climbs as lines key in, like a drive-thru board's.
    const keyedIn = Object.fromEntries(lines.filter(({ mark }) => mark !== 'leaving').map(({ id, quantity }) => [id, quantity]))
    const { total, delivery } = summarizeCart(keyedIn, orderType)
    return { lines, latest: state.latest, total, ...(delivery && { delivery }) }
  }, [state, cartDetails, orderType])
}

/** The server renders the cart as it is, with nothing keying in. */
function serverBoard() {
  return EMPTY_BOARD
}
