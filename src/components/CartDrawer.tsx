import { useEffect, useRef, type RefObject } from 'react'
import { useShoppingCart, type CartEntry } from 'use-shopping-cart'
import { findVariant, formatPrice, imagePath } from '../menu/menu'
import { useCartChanges, useOrderType } from '../pageContext'
import { DELIVERY_FEE, MAX_LINE_QUANTITY } from '../shop'
import { CheckoutButton } from './CheckoutButton'
import { OrderTypeSwitch } from './OrderTypeSwitch'

type CartDrawerProps = {
  /** Gets focus back when the drawer closes (the header's cart button). */
  returnFocusRef: RefObject<HTMLElement | null>
  /** The drawer's close button, which gets focus when it opens. The page holds it so other parts can focus it too. */
  closeButtonRef: RefObject<HTMLButtonElement | null>
}

// Open/closed is the cart library's `shouldDisplayCart`, so anything can open the
// drawer the same way: the cart button calls `handleCartClick()`, and a voice
// tool can call `handleCartHover()` (which only opens).
export function CartDrawer({ returnFocusRef, closeButtonRef }: CartDrawerProps) {
  const open = useShoppingCart((cart) => cart.shouldDisplayCart)
  const cartDetails = useShoppingCart((cart) => cart.cartDetails)
  const formattedTotalPrice = useShoppingCart((cart) => cart.formattedTotalPrice)
  const totalPrice = useShoppingCart((cart) => cart.totalPrice)
  // For delivery the total includes the fee, as Stripe charges it and the agent says it.
  const delivery = useOrderType() === 'delivery'
  const close = useShoppingCart((cart) => cart.handleCloseCart)
  const lines = Object.values(cartDetails)

  // Focus moves into the drawer when it opens and back to the cart button when it closes.
  const wasOpen = useRef(false)
  useEffect(() => {
    if (open) closeButtonRef.current?.focus()
    else if (wasOpen.current) returnFocusRef.current?.focus()
    wasOpen.current = open
  }, [open, returnFocusRef, closeButtonRef])

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

        {lines.length === 0 ? (
          <div className="drawer-empty">
            <p className="drawer-empty-title">Your cart is empty</p>
            <p>Pick something from the menu and press Add.</p>
          </div>
        ) : (
          <ul className="cart-lines">
            {lines.map((line) => (
              <CartLine key={line.id} line={line} />
            ))}
          </ul>
        )}
        {/* Pickup or delivery shows even with nothing in the cart: the agent asks it first. */}
        <div className="drawer-footer">
          <OrderTypeSwitch />
          {lines.length > 0 && (
            <>
              {delivery && (
                <p className="drawer-fee">
                  <span>Delivery</span>
                  <span>{formatPrice(DELIVERY_FEE)}</span>
                </p>
              )}
              <p className="drawer-total">
                <span>Total</span>
                <span>{delivery ? formatPrice((totalPrice ?? 0) + DELIVERY_FEE) : formattedTotalPrice}</span>
              </p>
              <CheckoutButton />
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function CartLine({ line }: { line: CartEntry }) {
  // Changes go through the page's cart changes, which tell the voice agent.
  const cartChanges = useCartChanges()
  // The photo comes from the menu, not the cart entry, so cart entries stay plain products.
  const found = findVariant(line.id)

  return (
    <li className="cart-line">
      {found ? (
        <img className="cart-line-photo" src={imagePath(found.item)} alt="" width={64} height={64} />
      ) : (
        <span className="cart-line-photo" />
      )}
      <div className="cart-line-info">
        <p className="cart-line-name">{line.name}</p>
        <p className="cart-line-price">{line.formattedPrice} each</p>
        <div className="cart-line-controls">
          <div className="quantity" role="group" aria-label={`Quantity of ${line.name}`}>
            <button
              type="button"
              aria-label={`One fewer ${line.name}`}
              disabled={line.quantity <= 1}
              onClick={() => cartChanges.tap({ type: 'quantity', id: line.id, quantity: line.quantity - 1 })}
            >
              −
            </button>
            <span className="quantity-value">{line.quantity}</span>
            <button
              type="button"
              aria-label={`One more ${line.name}`}
              disabled={line.quantity >= MAX_LINE_QUANTITY}
              onClick={() => cartChanges.tap({ type: 'quantity', id: line.id, quantity: line.quantity + 1 })}
            >
              +
            </button>
          </div>
          <button
            type="button"
            className="remove-button"
            aria-label={`Remove ${line.name}`}
            onClick={() => cartChanges.tap({ type: 'remove', id: line.id })}
          >
            Remove
          </button>
        </div>
      </div>
      <p className="cart-line-total">{line.formattedValue}</p>
    </li>
  )
}
