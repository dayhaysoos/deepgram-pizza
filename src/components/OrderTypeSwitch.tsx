import { useId } from 'react'
import { formatPrice } from '../menu/menu'
import { useCartChanges, useOrderType } from '../pageContext'
import { DELIVERY_FEE, ORDER_TYPES, type OrderType } from '../shop'

const LABELS: Record<OrderType, string> = { pickup: 'Pickup', delivery: 'Delivery' }

// Pickup or delivery, in the cart drawer above Checkout: a radio group drawn as
// a segmented control, like the size picker on a menu card. Neither is
// checked until the customer chooses, by tapping here or by telling the
// agent (set_order_type). A tap goes through the page's cart changes, which
// tell the agent during a voice session.
export function OrderTypeSwitch() {
  const orderType = useOrderType()
  const cartChanges = useCartChanges()
  const name = useId()

  return (
    <div className="order-type">
      <fieldset className="segmented">
        <legend className="visually-hidden">Pickup or delivery</legend>
        {ORDER_TYPES.map((type) => (
          <label key={type} className="segmented-option">
            <input
              type="radio"
              name={name}
              value={type}
              checked={orderType === type}
              onChange={() => cartChanges.tapOrderType(type)}
            />
            <span>{LABELS[type]}</span>
          </label>
        ))}
      </fieldset>
      {orderType === 'delivery' && (
        <p className="order-type-note">You&apos;ll enter the address at checkout. Delivery adds {formatPrice(DELIVERY_FEE)}.</p>
      )}
    </div>
  )
}
