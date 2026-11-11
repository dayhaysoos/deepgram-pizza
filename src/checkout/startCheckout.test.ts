import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CartDetails } from 'use-shopping-cart'
import { CHECKOUT_UNAVAILABLE, CHOOSE_ORDER_TYPE, type CheckoutResult } from './checkout'
import { createCheckoutSession } from './createCheckoutSession'
import { startCheckout, type CallCheckoutServer } from './startCheckout'

// startCheckout imports the real server function as its default, and that
// module imports `cloudflare:workers`, which only workerd has. Swapping the
// module for a stub keeps these tests in plain Node and lets the last test
// check the default.
vi.mock('./createCheckoutSession', () => ({ createCheckoutSession: vi.fn() }))

const SESSION_URL = 'https://checkout.stripe.com/c/pay/cs_test_fake'

const cartDetails: CartDetails = {
  fries: {
    id: 'fries',
    name: 'Fries',
    price: 499,
    currency: 'USD',
    quantity: 1,
    value: 499,
    formattedValue: '$4.99',
    formattedPrice: '$4.99',
    timestamp: '2026-11-10T00:00:00.000Z',
  },
}

function fakeServer(respond: () => Promise<CheckoutResult>) {
  return vi.fn<CallCheckoutServer>(respond)
}

describe('startCheckout', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('sends the cart and the order type to the server and returns the Checkout url', async () => {
    const callServer = fakeServer(async () => ({ url: SESSION_URL }))

    await expect(startCheckout(cartDetails, 'delivery', callServer)).resolves.toEqual({ url: SESSION_URL })
    expect(callServer).toHaveBeenCalledWith({ data: { cartDetails, orderType: 'delivery' } })
  })

  it("passes on the server's message when it turns the cart down", async () => {
    const callServer = fakeServer(async () => ({ message: 'The cart is empty.' }))

    await expect(startCheckout(cartDetails, 'pickup', callServer)).resolves.toEqual({ message: 'The cart is empty.' })
  })

  it("passes on the server's message when no order type was chosen", async () => {
    const callServer = fakeServer(async () => ({ message: CHOOSE_ORDER_TYPE }))

    await expect(startCheckout(cartDetails, undefined, callServer)).resolves.toEqual({ message: CHOOSE_ORDER_TYPE })
    expect(callServer).toHaveBeenCalledWith({ data: { cartDetails, orderType: undefined } })
  })

  it('returns a message instead of throwing when the request fails', async () => {
    const callServer = fakeServer(async () => {
      throw new TypeError('Failed to fetch')
    })

    await expect(startCheckout(cartDetails, 'pickup', callServer)).resolves.toEqual({ message: CHECKOUT_UNAVAILABLE })
    expect(console.error).toHaveBeenCalled()
  })

  it('calls the createCheckoutSession server function by default', async () => {
    vi.mocked(createCheckoutSession).mockResolvedValue({ url: SESSION_URL })

    await expect(startCheckout(cartDetails, 'pickup')).resolves.toEqual({ url: SESSION_URL })
    expect(createCheckoutSession).toHaveBeenCalledWith({ data: { cartDetails, orderType: 'pickup' } })
  })
})
