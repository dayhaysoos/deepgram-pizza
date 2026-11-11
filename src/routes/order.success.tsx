import { useEffect } from 'react'
import { createFileRoute, Link } from '@tanstack/react-router'
import { useShoppingCart } from 'use-shopping-cart'
import { clearSavedOrderType } from '../agent/orderType'
import { orderNumber } from '../checkout/checkout'
import { isOrderType, SHOP_NAME, type OrderType } from '../shop'

type OrderSuccessSearch = {
  /** The Checkout Session id. Stripe fills it in when it sends the customer here after paying. */
  session_id?: string
  /** Pickup or delivery, from the success url checkout built, so this page needn't ask Stripe. */
  type?: OrderType
}

/** What happens next, by order type. The shop is fictional, and so are the times. */
const NEXT_STEP: Record<OrderType, string> = {
  pickup: 'Ready for pickup in about 20 minutes.',
  delivery: 'Out for delivery soon.',
}

export const Route = createFileRoute('/order/success')({
  validateSearch: (search: Record<string, unknown>): OrderSuccessSearch => ({
    ...(typeof search.session_id === 'string' && search.session_id !== '' ? { session_id: search.session_id } : {}),
    ...(isOrderType(search.type) ? { type: search.type } : {}),
  }),
  head: () => ({ meta: [{ title: `Your order · ${SHOP_NAME}` }] }),
  component: OrderSuccess,
})

function OrderSuccess() {
  const { session_id: sessionId, type: orderType } = Route.useSearch()
  const clearCart = useShoppingCart((cart) => cart.clearCart)

  // The order is placed, so empty the cart. In the browser the saved cart is
  // read from localStorage when CartProvider creates the cart, before any
  // effect runs, so nothing restores it after this. Clearing an empty cart
  // changes nothing, so StrictMode's second run in dev and a reload are harmless.
  // The order is done: the next one starts with an empty cart, and asks pickup or delivery again.
  useEffect(() => {
    if (!sessionId) return
    clearCart()
    clearSavedOrderType()
  }, [sessionId, clearCart])

  return (
    <>
      {/* No cart button or category links: the cart was just emptied, and the menu is a page away. */}
      <header className="site-header">
        <div className="site-header-row">
          <Link to="/" className="brand">
            {SHOP_NAME}
          </Link>
        </div>
      </header>
      <main className="order">
        {sessionId ? (
          <>
            <h1>Thanks! Your order is in.</h1>
            <p>This was a Stripe test mode order, so no real payment was taken.</p>
            <p className="order-number">
              Order number: <strong>{orderNumber(sessionId)}</strong>
            </p>
            {orderType && <p>{NEXT_STEP[orderType]}</p>}
          </>
        ) : (
          <>
            <h1>No order to show</h1>
            <p>After you check out, your order number shows up here.</p>
          </>
        )}
        <Link to="/" className="order-link">
          Back to the menu
        </Link>
      </main>
    </>
  )
}
