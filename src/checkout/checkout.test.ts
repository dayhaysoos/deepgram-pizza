import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { products } from '../menu/menu'
import { DELIVERY_FEE, MAX_LINE_QUANTITY } from '../shop'
import {
  CHECKOUT_UNAVAILABLE,
  checkoutCart,
  CHOOSE_ORDER_TYPE,
  orderNumber,
  parseCheckoutRequest,
  type CheckoutInput,
  type SessionParams,
} from './checkout'

// Any two products work: these tests don't depend on what the menu sells.
const [first, second] = products

const TEST_KEY = 'sk_test_fake'
const ORIGIN = 'https://pizza.example'
const SESSION_URL = 'https://checkout.stripe.com/c/pay/cs_test_fake'

/** A stand-in for Stripe that records each call and returns a session url. */
function fakeStripe(respond: () => Promise<{ url: string | null }> = async () => ({ url: SESSION_URL })) {
  const calls: Array<{ secretKey: string; params: SessionParams }> = []
  async function createSession(secretKey: string, params: SessionParams) {
    calls.push({ secretKey, params })
    return respond()
  }
  return { calls, createSession }
}

function checkout(input: Partial<CheckoutInput>, stripe = fakeStripe()) {
  return checkoutCart(
    { cartDetails: {}, orderType: 'pickup', origin: ORIGIN, secretKey: TEST_KEY, ...input },
    stripe.createSession,
  )
}

// A cart line the way the browser posts it: use-shopping-cart's full entry.
function cartLine(product: (typeof products)[number], quantity: unknown) {
  return { ...product, quantity, value: product.price * Number(quantity), formattedValue: '', formattedPrice: '' }
}

describe('checkoutCart', () => {
  // Failures are logged server-side; keep the test output quiet.
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns the Checkout Session url', async () => {
    const result = await checkout({ cartDetails: { [first.id]: cartLine(first, 1) } })

    expect(result).toEqual({ url: SESSION_URL })
  })

  it('builds the line items from the menu, not from what the browser sent', async () => {
    const stripe = fakeStripe()
    const tampered = {
      ...cartLine(first, 2),
      name: 'Free Pizza',
      price: 1,
      currency: 'EUR',
      price_data: { unit_amount: 1 },
      product_data: { name: 'Free Pizza', metadata: { discount: '100%' } },
    }

    await checkout({ cartDetails: { [first.id]: tampered, [second.id]: cartLine(second, 1) } }, stripe)

    expect(stripe.calls[0].params.line_items).toEqual([
      {
        price_data: { currency: first.currency, unit_amount: first.price, product_data: { name: first.name } },
        quantity: 2,
      },
      {
        price_data: { currency: second.currency, unit_amount: second.price, product_data: { name: second.name } },
        quantity: 1,
      },
    ])
  })

  it('creates a payment session that returns to this site', async () => {
    const stripe = fakeStripe()

    await checkout({ cartDetails: { [first.id]: cartLine(first, 1) } }, stripe)

    const { params } = stripe.calls[0]
    expect(params.mode).toBe('payment')
    expect(params.success_url).toBe(`${ORIGIN}/order/success?session_id={CHECKOUT_SESSION_ID}&type=pickup`)
    expect(params.cancel_url).toBe(`${ORIGIN}/?checkout=cancelled`)
  })

  it('asks for the phone number on a pickup order, and no address', async () => {
    const stripe = fakeStripe()

    await checkout({ cartDetails: { [first.id]: cartLine(first, 1) }, orderType: 'pickup' }, stripe)

    expect(stripe.calls[0].params).toStrictEqual({
      mode: 'payment',
      line_items: expect.any(Array),
      success_url: `${ORIGIN}/order/success?session_id={CHECKOUT_SESSION_ID}&type=pickup`,
      cancel_url: `${ORIGIN}/?checkout=cancelled`,
      phone_number_collection: { enabled: true },
    })
  })

  it('asks for a US address and the phone number on a delivery order, and adds the delivery fee', async () => {
    const stripe = fakeStripe()

    await checkout({ cartDetails: { [first.id]: cartLine(first, 1) }, orderType: 'delivery' }, stripe)

    expect(stripe.calls[0].params).toStrictEqual({
      mode: 'payment',
      line_items: expect.any(Array),
      success_url: `${ORIGIN}/order/success?session_id={CHECKOUT_SESSION_ID}&type=delivery`,
      cancel_url: `${ORIGIN}/?checkout=cancelled`,
      phone_number_collection: { enabled: true },
      shipping_address_collection: { allowed_countries: ['US'] },
      shipping_options: [
        {
          shipping_rate_data: {
            type: 'fixed_amount',
            fixed_amount: { amount: DELIVERY_FEE, currency: 'usd' },
            display_name: 'Delivery',
          },
        },
      ],
    })
  })

  it('asks for pickup or delivery when the order type is missing', async () => {
    const stripe = fakeStripe()

    const result = await checkout({ cartDetails: { [first.id]: cartLine(first, 1) }, orderType: undefined }, stripe)

    expect(result).toEqual({ message: CHOOSE_ORDER_TYPE })
    expect(CHOOSE_ORDER_TYPE).toBe('Choose pickup or delivery first.')
    expect(stripe.calls).toEqual([])
  })

  it('checks the cart before the order type', async () => {
    const result = await checkout({ cartDetails: {}, orderType: undefined })

    expect(result).toEqual({ message: 'The cart is empty.' })
  })

  it('passes the secret key to Stripe', async () => {
    const stripe = fakeStripe()

    await checkout({ cartDetails: { [first.id]: cartLine(first, 1) } }, stripe)

    expect(stripe.calls[0].secretKey).toBe(TEST_KEY)
  })

  it('says so when the cart is empty', async () => {
    const stripe = fakeStripe()

    const result = await checkout({ cartDetails: {} }, stripe)

    expect(result).toEqual({ message: 'The cart is empty.' })
    expect(stripe.calls).toEqual([])
  })

  it('names an id that is not on the menu', async () => {
    const stripe = fakeStripe()

    const result = await checkout({ cartDetails: { [first.id]: cartLine(first, 1), hawaiian: { quantity: 1 } } }, stripe)

    expect(result).toEqual({ message: `That's not on the menu: "hawaiian". Remove it from the cart and try again.` })
    expect(stripe.calls).toEqual([])
  })

  it.each([0, MAX_LINE_QUANTITY + 1, 1.5, '2', -1, null, undefined])('names the product when its quantity is %j', async (quantity) => {
    const stripe = fakeStripe()

    const result = await checkout({ cartDetails: { [first.id]: cartLine(first, quantity) } }, stripe)

    expect(result).toEqual({
      message: `${first.name}: the quantity has to be a whole number from 1 to ${MAX_LINE_QUANTITY}. Change it and try again.`,
    })
    expect(stripe.calls).toEqual([])
  })

  it('accepts the largest quantity a line can hold', async () => {
    const result = await checkout({ cartDetails: { [first.id]: cartLine(first, MAX_LINE_QUANTITY) } })

    expect(result).toEqual({ url: SESSION_URL })
  })

  it('treats a cart line that is not an object as a bad quantity', async () => {
    const result = await checkout({ cartDetails: { [first.id]: 3 } })

    expect(result).toEqual({
      message: `${first.name}: the quantity has to be a whole number from 1 to ${MAX_LINE_QUANTITY}. Change it and try again.`,
    })
  })

  it('does not treat a "__proto__" key as a cart line it can skip', async () => {
    const cartDetails = JSON.parse(`{ "__proto__": { "quantity": 1 } }`)

    const result = await checkout({ cartDetails })

    expect(result).toEqual({ message: `That's not on the menu: "__proto__". Remove it from the cart and try again.` })
  })

  it.each([undefined, ''])('says checkout is not set up when the secret key is %j', async (secretKey) => {
    const stripe = fakeStripe()

    const result = await checkout({ cartDetails: { [first.id]: cartLine(first, 1) }, secretKey }, stripe)

    expect(result).toEqual({ message: "Checkout isn't set up on this shop yet." })
    expect(stripe.calls).toEqual([])
  })

  it.each(['sk_live_secret123', 'rk_live_secret123', 'rk_test_secret123'])(
    'refuses a key that is not a test secret key (%j), without repeating it',
    async (secretKey) => {
      const stripe = fakeStripe()

      const result = await checkout({ cartDetails: { [first.id]: cartLine(first, 1) }, secretKey }, stripe)

      expect(result).toEqual({ message: "Checkout only runs in Stripe test mode, and this shop's key isn't a test key." })
      expect(stripe.calls).toEqual([])
      const logged = vi.mocked(console.error).mock.calls.flat().join(' ')
      expect(logged).not.toContain(secretKey)
    },
  )

  it('recovers when Stripe throws, and logs the error', async () => {
    const stripe = fakeStripe(async () => {
      throw new Error('Stripe is down')
    })

    const result = await checkout({ cartDetails: { [first.id]: cartLine(first, 1) } }, stripe)

    expect(result).toEqual({ message: CHECKOUT_UNAVAILABLE })
    expect(console.error).toHaveBeenCalled()
  })

  it('recovers when Stripe returns a session without a url', async () => {
    const stripe = fakeStripe(async () => ({ url: null }))

    const result = await checkout({ cartDetails: { [first.id]: cartLine(first, 1) } }, stripe)

    expect(result).toEqual({ message: CHECKOUT_UNAVAILABLE })
  })
})

describe('parseCheckoutRequest', () => {
  it.each(['pickup', 'delivery'])('keeps cartDetails and the order type %j', (orderType) => {
    const cartDetails = { [first.id]: cartLine(first, 1) }

    expect(parseCheckoutRequest({ cartDetails, orderType, extra: true })).toStrictEqual({ cartDetails, orderType })
  })

  // A missing or unknown order type isn't a malformed request: checkoutCart
  // turns it into a message asking for pickup or delivery.
  it.each([undefined, null, '', 'Pickup', 'drive-thru', 1, {}])('leaves out the order type %j', (orderType) => {
    const cartDetails = { [first.id]: cartLine(first, 1) }

    expect(parseCheckoutRequest({ cartDetails, orderType })).toStrictEqual({ cartDetails, orderType: undefined })
  })

  it.each([undefined, null, 'cart', [], { cartDetails: null }, { cartDetails: [] }, { cartDetails: 'cart' }, {}])(
    'rejects %j',
    (data) => {
      expect(() => parseCheckoutRequest(data)).toThrow('Expected { cartDetails, orderType }')
    },
  )
})

describe('orderNumber', () => {
  it('is the last 8 letters and digits of the session id, uppercased', () => {
    expect(orderNumber('cs_test_a1B2c3D4e5F6g7H8')).toBe('E5F6G7H8')
  })

  it('ignores anything that is not a letter or digit', () => {
    expect(orderNumber('cs_test_ab<cd>ef-gh_ij')).toBe('CDEFGHIJ')
  })

  it('returns what there is when the id is short', () => {
    expect(orderNumber('cs_1')).toBe('CS1')
  })
})
