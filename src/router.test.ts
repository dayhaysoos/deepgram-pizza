import { describe, expect, it } from 'vitest'
import { getRouter } from './router'

describe('getRouter', () => {
  it('builds a router that knows the home page', () => {
    const router = getRouter()

    expect(router.routesByPath['/']).toBeDefined()
  })
})
