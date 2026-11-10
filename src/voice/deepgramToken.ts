// Minting a short-lived Deepgram token, without the framework. The browser opens
// the Voice Agent socket with this token, so the API key never leaves the
// server. getDeepgramToken.ts wires it to a server function; keeping the logic
// here lets tests run it with a fake fetch.
//
// grantDeepgramToken recovers instead of throwing: a missing key, a refused key
// or an unreachable Deepgram comes back as a short message the talk button can
// show. Logs carry hints for the developer, never the key or a token.
//
// Docs: https://developers.deepgram.com/reference/auth/tokens/grant
// and https://developers.deepgram.com/guides/fundamentals/token-based-authentication

/** Deepgram's endpoint for short-lived tokens. */
export const DEEPGRAM_GRANT_URL = 'https://api.deepgram.com/v1/auth/grant'

/**
 * How long a token lives, in seconds: Deepgram's default, sent explicitly.
 * A token only has to be valid while the socket opens, and the browser asks
 * for a new one before every connect and reconnect, so it can be short.
 */
export const TOKEN_TTL_SECONDS = 30

/** What the talk button shows when the shop has no Deepgram key. */
export const VOICE_NOT_SET_UP = "Voice isn't set up on this shop yet."

/** What the talk button shows when Deepgram refuses or can't be reached. */
export const VOICE_UNAVAILABLE = "Voice isn't available right now. Please try again in a moment."

/** A token to open the Voice Agent socket with, or a short message to show instead. */
export type DeepgramTokenResult = { token: string } | { message: string }

/**
 * Asks Deepgram for a short-lived token, using the API key.
 * `fetchFn` is the global `fetch` in the app and a fake in tests.
 */
export async function grantDeepgramToken(
  apiKey: string | undefined,
  fetchFn: typeof fetch,
): Promise<DeepgramTokenResult> {
  if (!apiKey) {
    console.error(
      'DEEPGRAM_API_KEY is not set. Put it in .dev.vars, or run `wrangler secret put DEEPGRAM_API_KEY`.',
    )
    return { message: VOICE_NOT_SET_UP }
  }

  let response: Response
  try {
    response = await fetchFn(DEEPGRAM_GRANT_URL, {
      method: 'POST',
      headers: { Authorization: `Token ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ttl_seconds: TOKEN_TTL_SECONDS }),
    })
  } catch (error) {
    console.error('Could not reach Deepgram for a voice token:', error instanceof Error ? error.message : error)
    return { message: VOICE_UNAVAILABLE }
  }

  if (!response.ok) {
    // 401: the key is wrong. 403: the key needs Member permissions or higher.
    console.error(
      `Deepgram refused the voice token request (HTTP ${response.status}). Check that DEEPGRAM_API_KEY is valid and has Member permissions or higher.`,
    )
    return { message: VOICE_UNAVAILABLE }
  }

  // Deepgram answers { access_token, expires_in }. Never log the body: it holds the token.
  const body: unknown = await response.json().catch(() => undefined)
  const token = isRecord(body) ? body.access_token : undefined
  if (typeof token !== 'string' || token === '') {
    console.error("Deepgram's voice token response had no access_token.")
    return { message: VOICE_UNAVAILABLE }
  }
  return { token }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
