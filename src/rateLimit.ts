// A speed limit for the two server functions, per visitor. Each one spends the
// shop's key at someone else's API (Deepgram's, Stripe's) for whoever calls it,
// and a script can call it as fast as it likes: the framework's same-origin
// check stops other websites, not scripts, which send whatever headers they
// choose.
//
// What it doesn't do: cap the Deepgram bill. One token opens a voice session
// that lasts as long as its caller wants, and Cloudflare counts loosely, in
// each of its locations on its own. See "Before you host it publicly" in
// README.md.
//
// The limits themselves are in wrangler.jsonc (`ratelimits`).
// Docs: https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/

/** What the talk button or the cart drawer shows, and the agent says, to a visitor over the limit. */
export const TOO_MANY_REQUESTS = 'Too many tries in a row. Please wait a minute and try again.'

/** A Cloudflare rate limit binding (`env.TOKEN_LIMITER`), or a fake in tests. */
export type Limiter = { limit(options: { key: string }): Promise<{ success: boolean }> }

/**
 * Whether this request's visitor is still under the limit, counting this
 * request. Visitors are told apart by IP address, the one thing known about a
 * customer with no account: Cloudflare's docs warn that people can share one
 * (an office, a phone network), so keep the limits loose.
 *
 * A limiter that fails lets the request through: the shop stays open.
 */
export async function underLimit(limiter: Limiter, request: Request): Promise<boolean> {
  // Cloudflare sets this header on every request it passes on. `pnpm dev` has
  // none, so everything on a developer's machine counts as one visitor.
  const key = request.headers.get('cf-connecting-ip') ?? 'local'
  try {
    const { success } = await limiter.limit({ key })
    return success
  } catch (error) {
    console.error('The rate limiter failed, so the request went through:', error instanceof Error ? error.message : error)
    return true
  }
}
