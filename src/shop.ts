// Shop-wide settings, and the rules built on them, that more than one part of the app reads.

/** The page title and the header brand. */
export const SHOP_NAME = "Nick's Pizza"

/** The most of one product a cart line can hold. The voice tools use the same cap. */
export const MAX_LINE_QUANTITY = 20

/** Whether a cart line can hold this quantity: a whole number from 1 to `MAX_LINE_QUANTITY`. */
export function isLineQuantity(quantity: unknown): quantity is number {
  return typeof quantity === 'number' && Number.isInteger(quantity) && quantity >= 1 && quantity <= MAX_LINE_QUANTITY
}

// Prices in menu.json are cents in this currency. The cart and every price
// formatter read these two, so server and browser format prices the same way.
export const CURRENCY = 'USD' as const
export const LOCALE = 'en-US'

/** How the customer gets the order: they pick it up, or it's delivered. Asked on every order. */
export const ORDER_TYPES = ['pickup', 'delivery'] as const
export type OrderType = (typeof ORDER_TYPES)[number]

/** Whether a value is one of ORDER_TYPES. */
export function isOrderType(value: unknown): value is OrderType {
  return typeof value === 'string' && (ORDER_TYPES as readonly string[]).includes(value)
}

/** The flat delivery fee, in cents of CURRENCY, added at checkout for delivery. */
export const DELIVERY_FEE = 399

/** The countries Stripe Checkout accepts delivery addresses in. */
export const DELIVERY_COUNTRIES = ['US'] as const
