// Pickup or delivery for the menu page: one store (orderType.ts) for the
// page's lifetime, starting from the choice saved in the browser. The cart
// drawer's switch and Checkout read it with useOrderType(); the cart changes,
// the tool handlers and the talk button's press read it with
// useOrderTypeStore() (src/pageContext.ts).

import { useState, type ReactNode } from 'react'
import { OrderTypeContext } from '../pageContext'
import { createOrderTypeStore } from './orderType'

/** Goes above `CartChangesProvider`, which tells the agent about taps on the switch. */
export function OrderTypeProvider({ children }: { children: ReactNode }) {
  // On the server there's no localStorage, so it starts with no choice.
  const [store] = useState(() => createOrderTypeStore())
  return <OrderTypeContext value={store}>{children}</OrderTypeContext>
}
