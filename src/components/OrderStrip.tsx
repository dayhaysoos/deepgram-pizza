import { useShoppingCart } from 'use-shopping-cart'
import { describeLine } from '../agent/cartSummary'
import { productName } from '../menu/menu'
import type { OrderBoard } from './orderBoard'
import { useOrderBoardView } from './useOrderBoard'

/**
 * The order on phones, where the full board (the cart drawer) would cover the
 * menu (the owner, 2026-11-11): a strip above the talk button with the last
 * line keyed in, changed or taken out, which follows the board as it keys
 * lines in, and the cart's total. Tapping it opens the cart. It shows while
 * the cart is closed and a line is in (not while the agent's first lines wait
 * for its voice); styles.css shows it only at phone width (PHONE_WIDTH in
 * src/layout.ts).
 */
export function OrderStrip({ board }: { board: OrderBoard }) {
  const { lines, anyKeyedIn, latest, toPay } = useOrderBoardView(board)
  const open = useShoppingCart((cart) => cart.shouldDisplayCart)
  const openCart = useShoppingCart((cart) => cart.handleCartHover)
  if (open || !anyKeyedIn) return null

  // Before the page has changed the cart (a cart loaded from storage), its last line.
  const last = lines.filter(({ mark }) => mark !== 'leaving').at(-1)
  const shown = latest ?? (last && { ...last, kind: 'added' as const, seq: 0 })
  const name = shown ? productName(shown.id) : undefined

  return (
    <button type="button" className="order-strip" onClick={openCart}>
      <span className="order-strip-label">Your order</span>
      {shown && name && (
        // A new key each time, so the line lights up again.
        <span key={shown.seq} className="order-strip-line" data-kind={shown.kind}>
          {shown.kind === 'removed' && <span className="visually-hidden">Removed </span>}
          {describeLine({ name, quantity: shown.quantity })}
        </span>
      )}
      <span className="order-strip-total">{toPay}</span>
      <span className="order-strip-open" aria-hidden="true">
        ›
      </span>
    </button>
  )
}
