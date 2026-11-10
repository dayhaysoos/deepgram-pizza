// Starting checkout from the browser. The cart drawer's Checkout button and the
// voice agent's checkout tool both come through here, so they behave the same:
// the server function's answer, or a short message when the request itself
// fails. It never throws.

import type { CartDetails } from 'use-shopping-cart'
import { CHECKOUT_UNAVAILABLE, type CheckoutResult } from './checkout'
import { createCheckoutSession } from './createCheckoutSession'

/** Asks the server for a Checkout Session: the `createCheckoutSession` server function, or a fake in tests. */
export type CallCheckoutServer = (request: { data: { cartDetails: CartDetails } }) => Promise<CheckoutResult>

/**
 * Starts Stripe Checkout for the cart. Returns `{ url }` to pass to
 * `redirectToCheckout`, or `{ message }` to show or say instead.
 */
export async function startCheckout(
  cartDetails: CartDetails,
  callServer: CallCheckoutServer = createCheckoutSession,
): Promise<CheckoutResult> {
  try {
    return await callServer({ data: { cartDetails } })
  } catch (error) {
    // The request itself failed: offline, or the server is down.
    console.error('Checkout request failed:', error)
    return { message: CHECKOUT_UNAVAILABLE }
  }
}
