// Shop-wide settings that more than one part of the app reads.

/** The page title and the header brand. */
export const SHOP_NAME = "Nick's Pizza"

/** The most of one product a cart line can hold. The voice tools use the same cap. */
export const MAX_LINE_QUANTITY = 20

// Prices in menu.json are cents in this currency. The cart and every price
// formatter read these two, so server and browser format prices the same way.
export const CURRENCY = 'USD' as const
export const LOCALE = 'en-US'
