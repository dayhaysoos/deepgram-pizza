# Nick's Pizza

Talk to a pizza shop. A voice agent answers questions about the menu, suggests what goes well together, plans orders for groups, and edits your cart as you talk, then sends you to Stripe Checkout.

Clone it to put voice ordering on your own shop: swap the menu, the photos and the agent's instructions.

> Work in progress: the app is being built step by step. The menu, cart and checkout land next.

## Stack

- [TanStack Start](https://tanstack.com/start/latest) (React) on [Cloudflare Workers](https://developers.cloudflare.com/workers/)
- [Deepgram Voice Agent](https://developers.deepgram.com/docs/voice-agent) for listening, thinking and speaking
- [use-shopping-cart](https://useshoppingcart.com) for the cart
- [Stripe Checkout](https://docs.stripe.com/checkout/quickstart) in test mode

## Setup

You need Node 22 or newer and [pnpm](https://pnpm.io).

```sh
git clone <repo-url> deepgram-pizza
cd deepgram-pizza
pnpm install
cp .dev.vars.example .dev.vars
```

Fill in both keys in `.dev.vars`, which stays out of git:

- `DEEPGRAM_API_KEY`: create an API key in the [Deepgram console](https://console.deepgram.com).
- `STRIPE_SECRET_KEY`: a Stripe test mode secret key (`sk_test_…`) from the [Stripe dashboard](https://dashboard.stripe.com/test/apikeys).

Then run `pnpm dev` and open http://localhost:3000.

## Checks

`pnpm check` runs lint, typecheck and tests. To check a deploy without publishing, run `pnpm build`, then `pnpm exec wrangler deploy --dry-run`.

## Deploy

Set both secrets on Cloudflare, then deploy:

```sh
pnpm exec wrangler secret put DEEPGRAM_API_KEY
pnpm exec wrangler secret put STRIPE_SECRET_KEY
pnpm run deploy
```

Deploy fails until both secrets are set: they're listed under `secrets.required` in `wrangler.jsonc`.

## How it works

The cart lives in the browser. When you ask for something, the voice agent calls a tool, and the tool updates the cart on the page. The server does two things: it mints a short-lived Deepgram token, so your API key never reaches the browser, and it creates the Stripe Checkout session from prices it checks itself.

## License

Code: [MIT](LICENSE). Food photos keep their own licenses; see [CREDITS.md](CREDITS.md).
