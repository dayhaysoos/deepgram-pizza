import { useEffect, useState } from 'react'
import { redirectToCheckout, useShoppingCart } from 'use-shopping-cart'
import { CHOOSE_ORDER_TYPE } from '../checkout/checkout'
import { startCheckout } from '../checkout/startCheckout'
import { useOrderType } from '../pageContext'

// The cart drawer's Checkout button. The server rebuilds the order from
// menu.json and creates a Stripe Checkout Session for pickup or delivery; the
// browser then goes to Stripe's page. Anything that stops checkout comes back
// as a short message, shown above the button. Before the customer has chosen
// pickup or delivery, a press asks them to, without calling the server.
export function CheckoutButton() {
  const cartDetails = useShoppingCart((cart) => cart.cartDetails)
  const orderType = useOrderType()
  const [pending, setPending] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  // Whether a press asked for pickup or delivery. The prompt goes once they choose.
  const [askedToChoose, setAskedToChoose] = useState(false)
  const shown = askedToChoose && !orderType ? CHOOSE_ORDER_TYPE : message

  // The browser's Back button can bring this page back from Stripe exactly as
  // it was left, still waiting. Make the button usable again.
  useEffect(() => {
    function onPageShow(event: PageTransitionEvent) {
      if (event.persisted) setPending(false)
    }
    window.addEventListener('pageshow', onPageShow)
    return () => window.removeEventListener('pageshow', onPageShow)
  }, [])

  async function checkout() {
    // One session per click: while a request is out, more clicks do nothing.
    if (pending) return
    setMessage(null)
    if (!orderType) {
      setAskedToChoose(true)
      return
    }
    setPending(true)
    const result = await startCheckout(cartDetails, orderType)
    if ('url' in result) {
      // The button stays pending while the browser leaves for Stripe.
      redirectToCheckout(result.url)
      return
    }
    setMessage(result.message)
    setPending(false)
  }

  return (
    <>
      {shown && (
        <p className="checkout-message" role="alert">
          {shown}
        </p>
      )}
      {/* aria-disabled, not disabled: a disabled button loses focus, and with it
          the screen reader's announcement of the new label. */}
      <button type="button" className="checkout-button" aria-disabled={pending} onClick={checkout}>
        {pending ? 'Taking you to checkout…' : 'Checkout'}
      </button>
    </>
  )
}
