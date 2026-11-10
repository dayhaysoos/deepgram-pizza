// Checkout without the framework: turns the cart the browser posted into a
// Stripe Checkout Session. createCheckoutSession.ts wires it to the request and
// to Stripe; keeping the logic here lets tests run it with a fake Stripe.
//
// Like the voice tools, it recovers instead of throwing: every problem comes
// back as a short message the agent can say or the cart drawer can show.

import { validateCartItems, type ValidatedItem } from 'use-shopping-cart/utilities'
import { findVariant, products } from '../menu/menu'
import { MAX_LINE_QUANTITY } from '../shop'

/** Where to send the customer, or a short message to show or say instead. */
export type CheckoutResult = { url: string } | { message: string }

/** The Checkout Session this shop asks Stripe for. */
export type SessionParams = {
  mode: 'payment'
  line_items: ValidatedItem[]
  success_url: string
  cancel_url: string
}

/** Creates a Checkout Session: Stripe's `checkout.sessions.create` in the app, a fake in tests. */
export type CreateSession = (secretKey: string, params: SessionParams) => Promise<{ url: string | null }>

export type CheckoutInput = {
  /** The cart as the browser posted it (use-shopping-cart's `cartDetails`). Only ids and quantities are read. */
  cartDetails: Record<string, unknown>
  /** This site's origin ("https://pizza.example"), for the urls Stripe sends the customer back to. */
  origin: string
  /** `STRIPE_SECRET_KEY`. Only test keys (`sk_test_…`) are accepted. */
  secretKey: string | undefined
}

/** The server function's input check: the body must be `{ cartDetails }`, with the cart as an object. */
export function parseCheckoutRequest(data: unknown): { cartDetails: Record<string, unknown> } {
  if (isRecord(data) && isRecord(data.cartDetails)) return { cartDetails: data.cartDetails }
  throw new Error("Expected { cartDetails }, the cart from use-shopping-cart's useShoppingCart().")
}

export async function createCheckout(input: CheckoutInput, createSession: CreateSession): Promise<CheckoutResult> {
  // Log a hint for the developer, never the key itself.
  const { secretKey } = input
  if (!secretKey) {
    console.error(
      'STRIPE_SECRET_KEY is not set. Put a test key (sk_test_…) in .dev.vars, or run `wrangler secret put STRIPE_SECRET_KEY`.',
    )
    return { message: "Checkout isn't set up on this shop yet." }
  }
  if (!secretKey.startsWith('sk_test_')) {
    console.error('STRIPE_SECRET_KEY is not a test secret key. This template only runs Stripe in test mode: use sk_test_….')
    return { message: "Checkout only runs in Stripe test mode, and this shop's key isn't a test key." }
  }

  // Everything else the browser sent (names, prices, metadata) is dropped here.
  const cart = idsAndQuantities(input.cartDetails)
  const lines = Object.entries(cart)
  if (lines.length === 0) return { message: 'The cart is empty.' }
  for (const [id, { quantity }] of lines) {
    const found = findVariant(id)
    if (!found) {
      return { message: `That's not on the menu: "${id}". Remove it from the cart and try again.` }
    }
    if (!isLineQuantity(quantity)) {
      return {
        message: `${found.product.name}: the quantity has to be a whole number from 1 to ${MAX_LINE_QUANTITY}. Change it and try again.`,
      }
    }
  }

  try {
    const session = await createSession(secretKey, {
      mode: 'payment',
      // Names and prices come from menu.json, through the product list.
      line_items: validateCartItems(products, cart as ValidateCartDetails),
      success_url: `${input.origin}/order/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${input.origin}/?checkout=cancelled`,
    })
    if (session.url) return { url: session.url }
    console.error('Stripe returned a Checkout Session without a url.')
  } catch (error) {
    console.error('Creating the Stripe Checkout Session failed:', error instanceof Error ? error.message : error)
  }
  return { message: "Checkout isn't available right now. Please try again in a moment." }
}

/**
 * A short order number for the success page, derived from the Checkout Session
 * id in its url, so showing it takes no call to Stripe: the id's last 8 letters
 * and digits, uppercased. It's for people to read; find the order in the Stripe
 * dashboard by the full session id.
 */
export function orderNumber(sessionId: string): string {
  return sessionId.replace(/[^a-z0-9]/gi, '').slice(-8).toUpperCase()
}

// validateCartItems is typed to take full cart entries, but it reads only each
// entry's quantity (and product_data.metadata, which we leave out on purpose).
type ValidateCartDetails = Parameters<typeof validateCartItems>[1]

/** Keeps only what checkout needs from each line: its id and its quantity. */
function idsAndQuantities(cartDetails: Record<string, unknown>): Record<string, { quantity: unknown }> {
  // Object.fromEntries, not assignment, so an id like "__proto__" stays a plain key.
  return Object.fromEntries(
    Object.entries(cartDetails).map(([id, line]) => [id, { quantity: isRecord(line) ? line.quantity : undefined }]),
  )
}

function isLineQuantity(quantity: unknown): quantity is number {
  return typeof quantity === 'number' && Number.isInteger(quantity) && quantity >= 1 && quantity <= MAX_LINE_QUANTITY
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
