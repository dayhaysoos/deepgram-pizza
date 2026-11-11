import { useEffect, useRef, type RefObject } from 'react'
import { useShoppingCart } from 'use-shopping-cart'
import { findVariant, formatPrice, imagePath, productName } from '../menu/menu'
import { useCartChanges } from '../pageContext'
import { MAX_LINE_QUANTITY } from '../shop'
import { CheckoutButton } from './CheckoutButton'
import type { BoardLine, OrderBoard } from './orderBoard'
import { OrderTypeSwitch } from './OrderTypeSwitch'
import { useOrderBoardView } from './useOrderBoard'

type CartDrawerProps = {
  /** Gets focus back when the drawer closes (the header's cart button). */
  returnFocusRef: RefObject<HTMLElement | null>
  /** The drawer's close button, which gets focus when it opens. The page holds it so other parts can focus it too. */
  closeButtonRef: RefObject<HTMLButtonElement | null>
  /** The page's order board (orderBoard.ts): how the lines key in, light up and leave. */
  board: OrderBoard
}

// Open/closed is the cart library's `shouldDisplayCart`, so anything can open the
// drawer the same way: the cart button calls `handleCartClick()`, and a voice
// tool can call `handleCartHover()` (which only opens).
//
// The drawer is the order board (the owner, 2026-11-11): its lines come from
// the board, so the lines a change adds key in one by one, lit as they land,
// a changed line lights up, and a line taken out is struck through as it
// fades. The total is the cart's, with the fee for delivery, as Stripe
// charges it and the agent says it (summarizeCart). It says the cart is
// empty only when it is: not while the agent's lines wait for its voice, nor
// while the last lines fade.
export function CartDrawer({ returnFocusRef, closeButtonRef, board }: CartDrawerProps) {
  const open = useShoppingCart((cart) => cart.shouldDisplayCart)
  const count = useShoppingCart((cart) => cart.cartCount)
  const { lines, anyKeyedIn, latest, delivery, toPay } = useOrderBoardView(board)
  const close = useShoppingCart((cart) => cart.handleCloseCart)
  const listRef = useRef<HTMLUListElement>(null)

  // Focus moves into the drawer when it opens and back to the cart button when it closes.
  const wasOpen = useRef(false)
  useEffect(() => {
    if (open) closeButtonRef.current?.focus()
    else if (wasOpen.current) returnFocusRef.current?.focus()
    wasOpen.current = open
  }, [open, returnFocusRef, closeButtonRef])

  // The line that just keyed in or changed comes into view, when a long order scrolls.
  useEffect(() => {
    if (!open || !latest || latest.kind === 'removed') return
    const line = [...(listRef.current?.children ?? [])].find((child) => child instanceof HTMLElement && child.dataset.lineId === latest.id)
    line?.scrollIntoView({ block: 'nearest' })
  }, [open, latest])

  // Escape closes it.
  useEffect(() => {
    if (!open) return
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') close()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open, close])

  return (
    <div className="drawer" data-open={open || undefined}>
      <div className="drawer-backdrop" onClick={close} />
      {/* No aria-modal: the page wrapper is already inert, and aria-modal would also hide the talk button, captions and voice errors. */}
      <div className="drawer-panel" role="dialog" aria-labelledby="cart-title">
        <div className="drawer-header">
          <h2 id="cart-title">Your order</h2>
          <button
            ref={closeButtonRef}
            type="button"
            className="icon-button"
            aria-label="Close cart"
            onClick={close}
          >
            ✕
          </button>
        </div>

        {lines.length === 0 && count === 0 ? (
          <div className="drawer-empty">
            <p className="drawer-empty-title">Your cart is empty</p>
            <p>Pick something from the menu and press Add.</p>
          </div>
        ) : (
          <ul className="cart-lines" ref={listRef}>
            {lines.map((line) => (
              <CartLine key={line.id} line={line} />
            ))}
          </ul>
        )}
        {/* Pickup or delivery shows even with nothing in the cart: the agent asks it first. */}
        <div className="drawer-footer">
          <OrderTypeSwitch />
          {anyKeyedIn && (
            <>
              {delivery && (
                <p className="drawer-fee">
                  <span>Delivery</span>
                  <span>{delivery.fee}</span>
                </p>
              )}
              <p className="drawer-total">
                <span>Total</span>
                <span>{toPay}</span>
              </p>
              <CheckoutButton />
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function CartLine({ line }: { line: BoardLine }) {
  // Changes go through the page's cart changes, which tell the voice agent.
  const cartChanges = useCartChanges()
  // Name, price and photo come from the menu, as the agent's cart summary's do;
  // a line on its way out is no longer in the cart.
  const found = findVariant(line.id)
  const name = productName(line.id)
  const leaving = line.mark === 'leaving'

  return (
    // A line on its way out is only a picture of what was there: screen readers skip it.
    <li className="cart-line" data-line-id={line.id} data-mark={line.mark} aria-hidden={leaving || undefined}>
      {found ? (
        <img className="cart-line-photo" src={imagePath(found.item)} alt="" width={64} height={64} />
      ) : (
        <span className="cart-line-photo" />
      )}
      <div className="cart-line-info">
        <p className="cart-line-name">{name}</p>
        {/* A line saved before menu.json changed has no price: checkout turns it down too. */}
        <p className="cart-line-price">{found ? `${formatPrice(found.variant.price)} each` : 'No longer on the menu'}</p>
        {!leaving && <div className="cart-line-controls">
          <div className="quantity" role="group" aria-label={`Quantity of ${name}`}>
            <button
              type="button"
              aria-label={`One fewer ${name}`}
              disabled={line.quantity <= 1}
              onClick={() => cartChanges.tap({ type: 'quantity', id: line.id, quantity: line.quantity - 1 })}
            >
              −
            </button>
            <span className="quantity-value">{line.quantity}</span>
            <button
              type="button"
              aria-label={`One more ${name}`}
              disabled={line.quantity >= MAX_LINE_QUANTITY}
              onClick={() => cartChanges.tap({ type: 'quantity', id: line.id, quantity: line.quantity + 1 })}
            >
              +
            </button>
          </div>
          <button
            type="button"
            className="remove-button"
            aria-label={`Remove ${name}`}
            onClick={() => cartChanges.tap({ type: 'remove', id: line.id })}
          >
            Remove
          </button>
        </div>}
      </div>
      <p className="cart-line-total">{found && formatPrice(found.variant.price * line.quantity)}</p>
    </li>
  )
}
