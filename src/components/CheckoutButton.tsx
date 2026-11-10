import { useEffect, useState } from 'react'
import { redirectToCheckout, useShoppingCart } from 'use-shopping-cart'
import { startCheckout } from '../checkout/startCheckout'

// The cart drawer's Checkout button. The server rebuilds the order from
// menu.json and creates a Stripe Checkout Session; the browser then goes to
// Stripe's page. Anything that stops checkout comes back as a short message,
// shown above the button.
export function CheckoutButton() {
  const cartDetails = useShoppingCart((cart) => cart.cartDetails)
  const [pending, setPending] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

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
    setPending(true)
    setMessage(null)
    const result = await startCheckout(cartDetails)
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
      {message && (
        <p className="checkout-message" role="alert">
          {message}
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
