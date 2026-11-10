# Nick's Pizza

Talk to a pizza shop. A voice agent answers questions about the menu, suggests what goes well together, plans orders for groups, and edits your cart as you talk, then sends you to Stripe Checkout.

Clone it to put voice ordering on your own shop: swap the menu, the photos and the agent's instructions.

> Work in progress: the app is being built step by step. The menu and cart work by clicking today; checkout and voice land next.

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

## Make it your own shop

**The menu** is `src/menu/menu.json`, one entry per item in the `MenuItem` shape from `src/menu/menu.ts`:

```json
{
  "id": "cheese-pizza",
  "name": "Cheese Pizza",
  "category": "pizza",
  "description": "Tomato sauce and melted mozzarella on a crisp, chewy crust.",
  "tags": ["vegetarian", "popular"],
  "variants": [
    { "id": "cheese-pizza-medium", "label": "Medium", "price": 1599, "serves": 2 },
    { "id": "cheese-pizza-large", "label": "Large", "price": 1899, "serves": 4 }
  ],
  "pairsWith": ["garlic-knots", "soda"]
}
```

- Prices are in cents: `1599` is $15.99.
- An item that comes in sizes has one variant per size. Each variant's id is `<item-id>-<size>` and it has a `label`, the size the customer sees.
- An item with one size has one variant whose id is the item id, with no `label`.
- `pairsWith` lists the ids of items that go well with this one.
- `serves` is how many people one of that variant feeds.

Run `pnpm check` after editing. The structural tests in `src/menu/menu.test.ts` catch a malformed menu and name the item or variant that breaks a rule.

The rest:

- **Categories:** their order, labels and size notes are in `categories` in `src/menu/menu.ts`. An item's `category` must be one of their ids.
- **Tags:** add the tag to `tags` in `src/menu/menu.ts`, then give it colours as `.tag-<name>` in `src/styles.css`, like `.tag-vegetarian`.
- **Shop name, currency and locale:** `src/shop.ts`.
- **Photos:** `public/images/<item-id>.jpg`, about 800 px wide and compressed. Use photos from Unsplash or Pexels, or your own, and add a row for each to `CREDITS.md`.
- **Colours and fonts:** the tokens at the top of `src/styles.css`.
- **The agent's instructions** arrive with the voice steps.

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

The cart lives in the browser. Voice and checkout, the next steps, are built around it: when you ask for something, the voice agent calls a tool, and the tool updates the cart on the page. The server will do two things: mint a short-lived Deepgram token, so your API key never reaches the browser, and create the Stripe Checkout session from prices it checks itself.

## License

Code: [MIT](LICENSE). Food photos keep their own licenses; see [CREDITS.md](CREDITS.md).
