import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'
import { grantDeepgramToken, TOKEN_TTL_SECONDS, VOICE_NOT_SET_UP, VOICE_UNAVAILABLE } from './deepgramToken'

const API_KEY = 'dg-fake-api-key'
const TOKEN = 'eyJhbGciOiJIUzI1NiJ9.fake-payload.fake-signature'

/** A stand-in for fetch that answers every request with `respond()`. */
function fakeFetch(respond: () => Promise<Response> = async () => Response.json({ access_token: TOKEN, expires_in: 30 })) {
  return vi.fn<typeof fetch>(respond)
}

describe('grantDeepgramToken', () => {
  let consoleError: MockInstance<typeof console.error>

  // Failures are logged server-side; keep the test output quiet.
  beforeEach(() => {
    consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  // Whatever happened, the logs never carry the key or a token.
  afterEach(() => {
    const logged = JSON.stringify(consoleError.mock.calls)
    expect(logged).not.toContain(API_KEY)
    expect(logged).not.toContain(TOKEN)
    vi.restoreAllMocks()
  })

  it('returns the token Deepgram grants', async () => {
    const result = await grantDeepgramToken(API_KEY, fakeFetch())

    expect(result).toEqual({ token: TOKEN })
    expect(consoleError).not.toHaveBeenCalled()
  })

  it('asks /v1/auth/grant for a short-lived token with the API key', async () => {
    const fetchFn = fakeFetch()

    await grantDeepgramToken(API_KEY, fetchFn)

    expect(fetchFn).toHaveBeenCalledTimes(1)
    const [url, init] = fetchFn.mock.calls[0]
    expect(url).toBe('https://api.deepgram.com/v1/auth/grant')
    expect(init?.method).toBe('POST')
    expect(init?.headers).toEqual({ Authorization: `Token ${API_KEY}`, 'Content-Type': 'application/json' })
    expect(JSON.parse(String(init?.body))).toEqual({ ttl_seconds: TOKEN_TTL_SECONDS })
  })

  it.each([undefined, ''])('says voice is not set up when the key is %j, without calling Deepgram', async (apiKey) => {
    const fetchFn = fakeFetch()

    const result = await grantDeepgramToken(apiKey, fetchFn)

    expect(result).toEqual({ message: VOICE_NOT_SET_UP })
    expect(fetchFn).not.toHaveBeenCalled()
    expect(consoleError).toHaveBeenCalledWith(expect.stringContaining('DEEPGRAM_API_KEY'))
    expect(consoleError).toHaveBeenCalledWith(expect.stringContaining('.dev.vars'))
    expect(consoleError).toHaveBeenCalledWith(expect.stringContaining('wrangler secret put DEEPGRAM_API_KEY'))
  })

  it('recovers when Deepgram refuses the key', async () => {
    const fetchFn = fakeFetch(async () =>
      Response.json({ err_code: 'INVALID_AUTH', err_msg: 'Invalid credentials.' }, { status: 401 }),
    )

    const result = await grantDeepgramToken(API_KEY, fetchFn)

    expect(result).toEqual({ message: VOICE_UNAVAILABLE })
    expect(consoleError).toHaveBeenCalledWith(expect.stringContaining('401'))
  })

  it('recovers when Deepgram cannot be reached', async () => {
    const fetchFn = fakeFetch(async () => {
      throw new TypeError('Network connection lost.')
    })

    const result = await grantDeepgramToken(API_KEY, fetchFn)

    expect(result).toEqual({ message: VOICE_UNAVAILABLE })
    expect(consoleError).toHaveBeenCalled()
  })

  it.each([
    ['a body that is not JSON', () => new Response('<html>Bad gateway</html>', { status: 200 })],
    ['no access_token', () => Response.json({ expires_in: 30 })],
    ['an empty access_token', () => Response.json({ access_token: '', expires_in: 30 })],
    ['an access_token that is not a string', () => Response.json({ access_token: 42, expires_in: 30 })],
    ['JSON that is not an object', () => Response.json([TOKEN])],
  ])('recovers from %s', async (_case, respond) => {
    const result = await grantDeepgramToken(API_KEY, fakeFetch(async () => respond()))

    expect(result).toEqual({ message: VOICE_UNAVAILABLE })
    expect(consoleError).toHaveBeenCalled()
  })
})
