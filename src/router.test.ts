import { describe, expect, it, vi } from 'vitest'
import { getRouter } from './router'

// The route tree reaches the server functions, which import `cloudflare:workers`.
// Only workerd has that module, so plain Node tests get an empty env instead.
vi.mock('cloudflare:workers', () => ({ env: {} }))

describe('getRouter', () => {
  it('builds a router that knows the home page and the order page', () => {
    const router = getRouter()

    expect(router.routesByPath['/']).toBeDefined()
    expect(router.routesByPath['/order/success']).toBeDefined()
  })
})
