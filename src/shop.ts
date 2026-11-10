// Shop-wide settings that more than one part of the app reads.

import type { MenuItem, Variant } from './menu/menu'

/** The page title and the header brand. */
export const SHOP_NAME = "Nick's Pizza"

/** The most of one product a cart line can hold. The voice tools use the same cap. */
export const MAX_LINE_QUANTITY = 20

/** The size a menu card selects first: the one that feeds the most people (Large, 12 pc). */
export function largestVariant(item: MenuItem): Variant {
  return item.variants.reduce((largest, variant) => (variant.serves > largest.serves ? variant : largest))
}
