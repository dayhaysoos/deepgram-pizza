// The checkout server function: the wiring between the browser, Stripe and the
// logic in checkout.ts. The client bundle gets only an RPC stub for it, so the
// Stripe SDK and the secret key stay on the server.

import { createServerFn } from '@tanstack/react-start'
import { getRequest } from '@tanstack/react-start/server'
import { env } from 'cloudflare:workers'
import Stripe from 'stripe'
import type { CartDetails } from 'use-shopping-cart'
import { createCheckout, parseCheckoutRequest, type SessionParams } from './checkout'

/**
 * Starts Stripe Checkout for the cart. Returns `{ url }` to pass to
 * `redirectToCheckout`, or `{ message }` to show or say instead.
 *
 * Call it with the cart: `createCheckoutSession({ data: { cartDetails } })`.
 */
export const createCheckoutSession = createServerFn({ method: 'POST' })
  .validator((data: { cartDetails: CartDetails }) => parseCheckoutRequest(data))
  .handler(({ data }) =>
    createCheckout(
      {
        cartDetails: data.cartDetails,
        origin: new URL(getRequest().url).origin,
        secretKey: env.STRIPE_SECRET_KEY,
      },
      createStripeSession,
    ),
  )

// Workers have no Node `https`, so the Stripe client uses its fetch-based HTTP
// client. It's built per call, after createCheckout has checked the key.
function createStripeSession(secretKey: string, params: SessionParams) {
  const stripe = new Stripe(secretKey, { httpClient: Stripe.createFetchHttpClient() })
  return stripe.checkout.sessions.create(params)
}
