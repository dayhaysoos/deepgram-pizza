import { isNotFound } from '@tanstack/react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { getRouter } from './router'
import { Route as DevToolsRoute } from './routes/dev.tools'

// The route tree reaches the server functions, which import `cloudflare:workers`.
// Only workerd has that module, so plain Node tests get an empty env instead.
vi.mock('cloudflare:workers', () => ({ env: {} }))

describe('getRouter', () => {
  it('builds a router that knows the home page, the order page and the dev tools page', () => {
    const router = getRouter()

    expect(router.routesByPath['/']).toBeDefined()
    expect(router.routesByPath['/order/success']).toBeDefined()
    expect(router.routesByPath['/dev/tools']).toBeDefined()
  })
})

describe('/dev/tools', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  // What the route's beforeLoad throws, if anything.
  function beforeLoadThrows(): unknown {
    try {
      DevToolsRoute.options.beforeLoad?.({} as never)
      return undefined
    } catch (thrown) {
      return thrown
    }
  }

  it('opens in dev', () => {
    vi.stubEnv('DEV', true)

    expect(beforeLoadThrows()).toBeUndefined()
  })

  it('is a 404 in a production build', () => {
    vi.stubEnv('DEV', false)

    expect(isNotFound(beforeLoadThrows())).toBe(true)
  })
})
