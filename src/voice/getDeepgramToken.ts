// The token server function: the wiring between the browser, Deepgram and the
// logic in deepgramToken.ts. The client bundle gets only an RPC stub for it, so
// the API key stays on the server.

import { createServerFn } from '@tanstack/react-start'
import { env } from 'cloudflare:workers'
import { grantDeepgramToken } from './deepgramToken'

/**
 * Mints a short-lived Deepgram token for the Voice Agent socket. Returns
 * `{ token }`, or `{ message }` to show instead. POST, so it's never cached.
 *
 * The browser calls it before every connect: `await getDeepgramToken()`.
 */
export const getDeepgramToken = createServerFn({ method: 'POST' }).handler(() =>
  grantDeepgramToken(env.DEEPGRAM_API_KEY, fetch),
)
