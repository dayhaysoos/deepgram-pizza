import { describe, expect, it, vi } from 'vitest'
import { underLimit, type Limiter } from './rateLimit'

function requestFrom(ip?: string): Request {
  return new Request('https://pizza.example/_serverFn/abc', {
    method: 'POST',
    headers: ip ? { 'cf-connecting-ip': ip } : {},
  })
}

/** A limiter that allows `allowed` requests for each key, then refuses. */
function limiterAllowing(allowed: number): Limiter & { keys: string[] } {
  const keys: string[] = []
  return {
    keys,
    limit: async ({ key }) => {
      keys.push(key)
      return { success: keys.filter((seen) => seen === key).length <= allowed }
    },
  }
}

describe('underLimit', () => {
  it('lets a visitor through until the limiter refuses them', async () => {
    const limiter = limiterAllowing(2)

    expect(await underLimit(limiter, requestFrom('203.0.113.7'))).toBe(true)
    expect(await underLimit(limiter, requestFrom('203.0.113.7'))).toBe(true)
    expect(await underLimit(limiter, requestFrom('203.0.113.7'))).toBe(false)
  })

  it('counts each IP address on its own', async () => {
    const limiter = limiterAllowing(1)

    expect(await underLimit(limiter, requestFrom('203.0.113.7'))).toBe(true)
    expect(await underLimit(limiter, requestFrom('203.0.113.7'))).toBe(false)
    expect(await underLimit(limiter, requestFrom('198.51.100.4'))).toBe(true)
    expect(limiter.keys).toEqual(['203.0.113.7', '203.0.113.7', '198.51.100.4'])
  })

  it('counts requests with no Cloudflare address as one visitor, as in pnpm dev', async () => {
    const limiter = limiterAllowing(1)

    expect(await underLimit(limiter, requestFrom())).toBe(true)
    expect(await underLimit(limiter, requestFrom())).toBe(false)
    expect(limiter.keys).toEqual(['local', 'local'])
  })

  it('lets the request through when the limiter fails, and logs why', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    const broken: Limiter = { limit: () => Promise.reject(new Error('limiter is down')) }

    expect(await underLimit(broken, requestFrom('203.0.113.7'))).toBe(true)
    expect(logged).toHaveBeenCalledWith(expect.stringContaining('rate limiter failed'), 'limiter is down')

    logged.mockRestore()
  })
})
