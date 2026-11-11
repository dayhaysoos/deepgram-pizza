// Checkout without the framework: turns the cart the browser posted into a
// Stripe Checkout Session. createCheckoutSession.ts wires it to the request and
// to Stripe; keeping the logic here lets tests run it with a fake Stripe.
//
// checkoutCart recovers instead of throwing: every problem with the cart, the
// order type, the key or Stripe comes back as a short message the cart drawer
// can show and the voice agent can say. Only a malformed request body throws,
// in parseCheckoutRequest, because that's the server function's input check.
//
// Pickup and delivery differ only in what Stripe's page asks for: a phone
// number for both, and for delivery a US address and the flat delivery fee as
// a shipping option. The order type also rides on the success url, so the
// order page can say "pickup" or "delivery" without asking Stripe.

import { validateCartItems, type ValidatedItem } from 'use-shopping-cart/utilities'
import { isRecord } from '../isRecord'
import { findVariant, products } from '../menu/menu'
import {
  CURRENCY,
  DELIVERY_COUNTRIES,
  DELIVERY_FEE,
  isLineQuantity,
  isOrderType,
  MAX_LINE_QUANTITY,
  type OrderType,
} from '../shop'

/** What to show or say when Stripe fails, or the request never reaches the server. */
export const CHECKOUT_UNAVAILABLE = "Checkout isn't available right now. Please try again in a moment."

/** What to show or say when checkout comes without pickup or delivery chosen. */
export const CHOOSE_ORDER_TYPE = 'Choose pickup or delivery first.'

/** Where to send the customer, or a short message to show or say instead. */
export type CheckoutResult = { url: string } | { message: string }

/** The Checkout Session this shop asks Stripe for: a subset of Stripe's `SessionCreateParams`. */
export type SessionParams = {
  mode: 'payment'
  line_items: ValidatedItem[]
  success_url: string
  cancel_url: string
  /** A required phone field on Stripe's page, so the shop can call about the order. */
  phone_number_collection: { enabled: true }
  /** Delivery only: the address fields, limited to DELIVERY_COUNTRIES. */
  shipping_address_collection?: { allowed_countries: Array<(typeof DELIVERY_COUNTRIES)[number]> }
  /** Delivery only: the delivery fee, shown as its own line in Stripe's summary. */
  shipping_options?: Array<{
    shipping_rate_data: {
      type: 'fixed_amount'
      /** Cents, and a lowercase currency code, as Stripe's docs ask. */
      fixed_amount: { amount: number; currency: string }
      display_name: string
    }
  }>
}

/** Creates a Checkout Session: Stripe's `checkout.sessions.create` in the app, a fake in tests. */
export type CreateSession = (secretKey: string, params: SessionParams) => Promise<{ url: string | null }>

export type CheckoutInput = {
  /** The cart as the browser posted it (use-shopping-cart's `cartDetails`). Only ids and quantities are read. */
  cartDetails: Record<string, unknown>
  /** Pickup or delivery. Without one, checkout asks for it instead. */
  orderType: OrderType | undefined
  /** This site's origin ("https://pizza.example"), for the urls Stripe sends the customer back to. */
  origin: string
  /** `STRIPE_SECRET_KEY`. Only test keys (`sk_test_…`) are accepted. */
  secretKey: string | undefined
}

/** What the server function reads from the request body. */
export type CheckoutRequest = Pick<CheckoutInput, 'cartDetails' | 'orderType'>

/**
 * The server function's input check: the body must be `{ cartDetails, orderType }`,
 * with the cart as an object. An order type that isn't one of ORDER_TYPES is
 * left out rather than refused, so checkoutCart can ask for pickup or delivery.
 */
export function parseCheckoutRequest(data: unknown): CheckoutRequest {
  if (isRecord(data) && isRecord(data.cartDetails)) {
    return { cartDetails: data.cartDetails, orderType: isOrderType(data.orderType) ? data.orderType : undefined }
  }
  throw new Error("Expected { cartDetails, orderType }, the cart from use-shopping-cart's useShoppingCart().")
}

/** Checks out the cart: a Stripe Checkout url, or a short message saying why not. */
export async function checkoutCart(input: CheckoutInput, createSession: CreateSession): Promise<CheckoutResult> {
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

  // Checked here too, not only in parseCheckoutRequest: the browser decides nothing.
  const { orderType } = input
  if (!isOrderType(orderType)) return { message: CHOOSE_ORDER_TYPE }

  try {
    const session = await createSession(secretKey, {
      mode: 'payment',
      // Names and prices come from menu.json, through the product list.
      line_items: validateCartItems(products, cart as ValidateCartDetails),
      success_url: `${input.origin}/order/success?session_id={CHECKOUT_SESSION_ID}&type=${orderType}`,
      cancel_url: `${input.origin}/?checkout=cancelled`,
      phone_number_collection: { enabled: true },
      ...(orderType === 'delivery' ? DELIVERY : {}),
    })
    if (session.url) return { url: session.url }
    console.error('Stripe returned a Checkout Session without a url.')
  } catch (error) {
    console.error('Creating the Stripe Checkout Session failed:', error instanceof Error ? error.message : error)
  }
  return { message: CHECKOUT_UNAVAILABLE }
}

/** What a delivery order adds to the session: Stripe collects the address and charges the flat fee. */
const DELIVERY = {
  shipping_address_collection: { allowed_countries: [...DELIVERY_COUNTRIES] },
  shipping_options: [
    {
      shipping_rate_data: {
        type: 'fixed_amount',
        fixed_amount: { amount: DELIVERY_FEE, currency: CURRENCY.toLowerCase() },
        display_name: 'Delivery',
      },
    },
  ],
} satisfies Pick<SessionParams, 'shipping_address_collection' | 'shipping_options'>

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
