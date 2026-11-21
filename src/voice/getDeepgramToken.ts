// The token server function: the wiring between the browser, Deepgram and the
// logic in deepgramToken.ts. The client bundle gets only an RPC stub for it, so
// the API key stays on the server.

import { createServerFn } from '@tanstack/react-start'
import { getRequest } from '@tanstack/react-start/server'
import { env } from 'cloudflare:workers'
import { TOO_MANY_REQUESTS, underLimit } from '../rateLimit'
import { grantDeepgramToken, type DeepgramTokenResult } from './deepgramToken'

/**
 * Mints a short-lived Deepgram token for the Voice Agent socket. Returns
 * `{ token }`, or `{ message }` to show instead. POST, so it's never cached.
 *
 * The browser calls it before every connect: `await getDeepgramToken()`.
 * A visitor who asks too often gets a message instead (src/rateLimit.ts).
 */
export const getDeepgramToken = createServerFn({ method: 'POST' }).handler(async (): Promise<DeepgramTokenResult> => {
  if (!(await underLimit(env.TOKEN_LIMITER, getRequest()))) return { message: TOO_MANY_REQUESTS }
  return grantDeepgramToken(env.DEEPGRAM_API_KEY, fetch)
})
