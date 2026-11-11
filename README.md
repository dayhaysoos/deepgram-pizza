# Nick's Pizza

Talk to a pizza shop. A voice agent answers questions about the menu, suggests what goes well together, plans orders for groups, and edits your cart as you talk, then sends you to Stripe Checkout.

Clone it to put voice ordering on your own shop: swap the menu, the photos and the agent's instructions.

> Work in progress: the app is being built step by step. The menu, the cart and test mode checkout work by clicking, and by voice: the agent finds items on the menu, changes your cart and checks you out.

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

- `DEEPGRAM_API_KEY`: create an API key in the [Deepgram console](https://console.deepgram.com) with **Member** permissions or higher (Create Key → Advanced → Member). The server uses it to mint short-lived tokens, and Deepgram refuses that with a 403 for keys below Member.
- `STRIPE_SECRET_KEY`: a Stripe test mode secret key (`sk_test_…`) from the [Stripe dashboard](https://dashboard.stripe.com/test/apikeys).

Voice also needs a microphone. Browsers allow one only on `https://` pages and on `localhost`, so open the dev server at `localhost`, not at your machine's network address.

Then run `pnpm dev` and open http://localhost:3000.

### Try checkout

Add something to the cart, open it, choose **Pickup** or **Delivery** and press **Checkout** (without a choice, the cart asks for one). Stripe's test checkout page opens and asks for a phone number; for delivery it also asks for a US address and adds a $3.99 Delivery line to the total. Pay with the test card `4242 4242 4242 4242`, any future expiry date and any CVC, and a made-up phone number and address. Stripe sends you back to the order page, which shows an order number, says when the order will be ready for pickup or that it's out for delivery soon, and empties the cart. Leave Stripe's page with its back link instead and the menu says checkout was cancelled, with the cart as you left it.

The server accepts only Stripe test keys (`sk_test_…`), so no real payment can be taken.

### Try voice

Press **Talk to order** at the bottom of the screen and allow the microphone when the browser asks. The agent greets you and asks whether it's for pickup or delivery ("Delivery." "Great, delivery it is. What can I get you?"), and the cart's **Pickup | Delivery** switch shows your answer; once you've chosen, it asks "Still delivery today?" instead. You'll enter a delivery address on Stripe's page, never by voice. Then ask it about the menu, such as "What's vegetarian?" The button shows what the agent is doing (connecting, listening, thinking, speaking), and captions above it show what it heard and its reply. **Show conversation** above the captions opens the whole conversation, which stays until you press the button again.

Then order by voice. "What's vegetarian?" lights up the matching menu cards. "Add two large margheritas" adds them, opens the cart the first time, and the agent confirms the change and the new total; "Actually, make that one" changes the quantity. Ask what goes with something, or for a recommendation, and the suggestions appear on a card you can add from. When you're done, say so: the agent reads back your order and total, and once you confirm and it has said it's taking you to checkout, the session ends and the browser goes to Stripe's test checkout.

You can tap while you talk. Each change you make by tapping (Add, − or +, Remove, Add all, Pickup or Delivery) goes to the agent as a note with pickup or delivery and the whole cart, so "What's my total?" counts it.

While it works out a reply, the captions say what it's doing under your line: "Thinking…", or what the tool it called is doing, such as "Searching the menu…" or "Adding to your cart…". The session ends when you press the button again, when you leave the page, after 60 seconds without speech from either side, or when it takes you to checkout.

For a log of every session, talk from http://localhost:3000/dev/tools: its **Session log** shows what you and the agent said, with times, every message from Deepgram but the audio, each tool's answer (`tool add_item → {…}`, marked "confirmed by Deepgram" once Deepgram echoes it back) and each tap update the agent was told (`told the agent: Customer added 1 × Fries by tapping…`), for every session until you press **Clear**. **Copy as text** or **Copy as JSON** to share it, for example in a bug report. It's for development only; the browser console also prints each line as `[voice] you: …` and `[voice] agent: …`.

### Try the tools without a microphone

Run `pnpm dev` and open http://localhost:3000/dev/tools. It's the menu page with a panel that runs the voice agent's tools through the same handlers the agent uses, so the page changes exactly as it will for a voice tool call. Pick a tool, edit its JSON arguments and press **Run** to see the result the agent would get back. Or use a preset, which fills in a call and runs it:

- **Golden path:** choose delivery, find the vegetarian items, add two large margheritas, make that one, read the total, check out. Check out goes straight to Stripe's test checkout, unless a voice session is on: then it waits for the agent to finish speaking first.
- **Suggestions:** what goes with the cheeseburger, then two parties planned by `plan_group_order`: 30 people with 10 vegetarians, and 20 people. The code works out how much food from each item's `serves`, leaving room for what's already in the cart, and puts it on the suggestion card. Each party's **Add all of that** adds its plan.
- **Recovery:** calls the agent can get wrong, such as an item that isn't on the menu or a pizza without a size. Each answers with a message the agent can act on.

When you change the cart by tapping (Add on a menu card, − or + or Remove or Pickup or Delivery in the cart, Add or Add all on the suggestion card), the panel logs the update it sends the agent, with a voice session or without; the agent gets it only while a session is on.

The page is for development only. A production build leaves the panel out, and `/dev/tools` answers 404.

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
- `serves` is how many people one of that variant feeds. The group-order planner reads it.
- `spokenName` (optional) is how the agent says the item in a sentence when its name doesn't read well aloud, such as `"garlic knots"` for "Garlic Knots (6)". Without it, the agent uses the name in lower case.

Run `pnpm check` after editing. The structural tests in `src/menu/menu.test.ts` catch a malformed menu and name the item or variant that breaks a rule.

The rest:

- **Categories:** their order, labels and size notes are in `categories` in `src/menu/menu.ts`. An item's `category` must be one of their ids. For group orders, give a category a `plan`: `'main'` for mains (the planner feeds about one serving per person from them, and the customer can ask for one main category or a mix by its id), `'side'` for shareable sides, or `'drink'` for one drink each. A main category also needs a `noun`, how the plan's summary counts its items: `['pizza', 'pizzas']`. Leave `plan` out for a category the planner shouldn't touch, such as dessert. Every item in a main category needs the same sizes, as every pizza is Medium for 2 and Large for 4; `pnpm test` checks it.
- **Tags:** add the tag to `tags` in `src/menu/menu.ts`, then give it colours as `.tag-<name>` in `src/styles.css`, like `.tag-vegetarian`.
- **Shop name, currency, locale and delivery:** `src/shop.ts`, which also sets the delivery fee and the countries Stripe takes delivery addresses in. The agent says totals in English words and US dollars ("twenty ninety-nine"), from `src/agent/spokenPrice.ts`; rewrite it for another currency or language.
- **Photos:** `public/images/<item-id>.jpg`, about 800 px wide and compressed. Use photos from Unsplash or Pexels, or your own, and add a row for each to `CREDITS.md`.
- **Colours and fonts:** the tokens at the top of `src/styles.css`.
- **The agent's instructions:** its greeting, persona and rules are in `src/agent/instructions.ts`. It knows the menu from `menu.json`, and the cart and pickup or delivery as they are when you press the talk button. The models it listens, thinks and speaks with, and its voice, are in `src/voice/agentSettings.ts`; it listens for your item names as keyterms, read from `menu.json`, so speech-to-text hears "margherita" rather than "margarita".

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

**Before you host it publicly:** the token server function has no rate limit or authentication. Anyone who can open your shop can mint Deepgram tokens on your key and run up your Deepgram bill. Add a rate limit or a sign-in first.

## How it works

The cart lives in the browser, and voice is built around it: the voice agent changes the cart only by calling a tool, and the tool updates the cart on the page (`src/agent/`). The browser talks to Deepgram directly. The server does two things. It mints a short-lived Deepgram token each time the browser connects to Deepgram, so your API key never reaches the browser (`src/voice/getDeepgramToken.ts`). And it creates the Stripe Checkout session, taking names and prices from `menu.json` rather than from the cart the browser sends (`src/checkout/`).

## License

Code: [MIT](LICENSE). Food photos keep their own licenses; see [CREDITS.md](CREDITS.md).
