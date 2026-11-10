# Nick's Pizza: spec

What to build for v1. `AGENTS.md` holds the rules; this file holds the decisions. When something here is still open, it's listed under Open questions: ask instead of guessing.

## The shop

Nick's Pizza is a classic neighbourhood pizzeria with pizza, subs, wings, burgers, salads, sides, drinks and dessert. Prices are in USD. There is no tax, delivery fee or tip in v1.

## Menu

30 items. `menu.json` holds them in this shape:

```ts
type MenuItem = {
  id: string
  name: string
  category: 'pizza' | 'subs' | 'wings' | 'burgers' | 'salads' | 'sides' | 'drinks' | 'dessert'
  description: string
  tags: Array<'vegetarian' | 'vegan' | 'spicy' | 'popular'>
  variants: Array<{ id: string; label?: string; price: number; serves: number }>
  pairsWith: string[]
}
```

- `price` is in cents.
- An item with one size has one variant whose `id` equals the item `id` and that has no `label`.
- A sized variant's `id` is `<item-id>-<size>` (`pepperoni-pizza-large`).
- `pairsWith` lists item ids. The agent uses them for suggestions.
- `serves` is how many people one of that variant feeds. The agent uses it to plan group orders:

  | Variant | Serves |
  |---|---|
  | Large pizza | 4 |
  | Medium pizza | 2 |
  | Wing Dings 12 pc | 4 |
  | Wing Dings 6 pc | 2 |
  | Garlic knots, fries, mozzarella sticks | 2 |
  | Sub, sandwich, burger, salad, drink, cannoli | 1 |
- One function turns the menu into the flat product list the cart and `validateCartItems` use: one product per variant, `{ id, name, price, currency: 'USD' }`. Its `name` includes the size ("Large Pepperoni Pizza").

### Pizza: Medium 14" / Large 18"

| id | Name | Medium | Large | Tags | Pairs with |
|---|---|---|---|---|---|
| `cheese-pizza` | Cheese Pizza | 15.99 | 18.99 | vegetarian, popular | garlic-knots, soda |
| `pepperoni-pizza` | Pepperoni Pizza | 17.99 | 20.99 | popular | garlic-knots, soda |
| `margherita-pizza` | Margherita Pizza | 17.99 | 20.99 | vegetarian | caesar-salad, lemonade |
| `meat-lovers-pizza` | Meat Lovers Pizza | 20.99 | 24.99 | | garlic-knots, soda |
| `veggie-supreme-pizza` | Veggie Supreme Pizza | 19.99 | 22.99 | vegetarian | garden-salad, lemonade |
| `buffalo-chicken-pizza` | Buffalo Chicken Pizza | 19.99 | 22.99 | spicy | mozzarella-sticks, soda |
| `white-pizza` | White Pizza | 18.99 | 21.99 | vegetarian | greek-salad, lemonade |

### Subs and sandwiches

| id | Name | Price | Tags | Pairs with |
|---|---|---|---|---|
| `italian-sub` | Italian Sub | 12.99 | | fries, soda |
| `meatball-parm-sub` | Meatball Parm Sub | 11.99 | | garlic-knots, soda |
| `chicken-cutlet-sandwich` | Chicken Cutlet Sandwich | 11.99 | | fries, lemonade |
| `philly-cheesesteak` | Philly Cheesesteak | 13.99 | popular | fries, soda |
| `eggplant-parm-sub` | Eggplant Parm Sub | 10.99 | vegetarian | garden-salad, lemonade |

### Wing Dings: 6 pc / 12 pc

| id | Name | 6 pc | 12 pc | Tags | Pairs with |
|---|---|---|---|---|---|
| `buffalo-wings` | Buffalo Wing Dings | 8.99 | 15.99 | spicy, popular | fries, soda |
| `honey-bbq-wings` | Honey BBQ Wing Dings | 8.99 | 15.99 | | fries, soda |
| `garlic-parm-wings` | Garlic Parm Wing Dings | 8.99 | 15.99 | | garlic-knots, lemonade |
| `lemon-pepper-wings` | Lemon Pepper Wing Dings | 8.99 | 15.99 | | fries, lemonade |

Variant ids: `buffalo-wings-6pc`, `buffalo-wings-12pc`. "A dozen" means 12 pc.

### Burgers

| id | Name | Price | Tags | Pairs with |
|---|---|---|---|---|
| `classic-cheeseburger` | Classic Cheeseburger | 10.99 | popular | fries, soda |
| `bacon-bbq-burger` | Bacon BBQ Burger | 12.99 | | fries, soda |
| `mushroom-swiss-burger` | Mushroom Swiss Burger | 11.99 | | fries, lemonade |
| `black-bean-burger` | Black Bean Burger | 10.99 | vegetarian | fries, lemonade |

### Salads

| id | Name | Price | Tags | Pairs with |
|---|---|---|---|---|
| `caesar-salad` | Caesar Salad | 8.99 | | garlic-knots |
| `garden-salad` | Garden Salad | 7.99 | vegetarian, vegan | lemonade |
| `greek-salad` | Greek Salad | 9.99 | vegetarian | lemonade |
| `buffalo-chicken-salad` | Buffalo Chicken Salad | 11.99 | spicy | soda |

Caesar isn't vegetarian (anchovy dressing), and the agent should say so if asked.

### Sides, drinks, dessert

| id | Name | Category | Price | Tags | Pairs with |
|---|---|---|---|---|---|
| `garlic-knots` | Garlic Knots (6) | sides | 5.99 | vegetarian, popular | |
| `fries` | Fries | sides | 4.99 | vegetarian, vegan | |
| `mozzarella-sticks` | Mozzarella Sticks | sides | 7.99 | vegetarian | |
| `soda` | Fountain Soda | drinks | 2.49 | vegetarian, vegan | |
| `lemonade` | Fresh Lemonade | drinks | 3.49 | vegetarian, vegan | |
| `cannoli` | Cannoli | dessert | 4.99 | vegetarian, popular | |

Write a one-line `description` for each item when building `menu.json`.

## Tools

The menu goes into the agent's instructions in compact form (ids, names, sizes, prices, `serves`, tags, `pairsWith`), so the agent can resolve "a large pepperoni" to an id and make suggestions on its own. Tools exist where they change state or change the screen.

Every cart tool returns the cart summary:

```ts
type CartSummary = {
  lines: Array<{ id: string; name: string; quantity: number; total: string }>
  count: number
  total: string
}
```

| Tool | Parameters | Does | Returns |
|---|---|---|---|
| `find_menu_items` | `category?`, `tags?`, `max_price?` (dollars), `query?` | Filters the menu and highlights the matching cards on screen | matching items with their variants and prices |
| `show_suggestions` | `title`, `items: Array<{ id, quantity }>`, `reason?` | Opens the suggestion card (see Screens). It doesn't change the cart. | `{ shown: true, total }` (the total if every suggestion were added) |
| `add_item` | `id` (variant id), `quantity` (1–20) | `addItem` | `CartSummary` |
| `add_items` | `items: Array<{ id, quantity }>` (up to 15 lines) | `addItem` for each line, in one call | `CartSummary` |
| `set_quantity` | `id`, `quantity` (1–20) | `setItemQuantity` | `CartSummary` |
| `remove_item` | `id` | `removeItem` | `CartSummary` |
| `view_cart` | none | reads the cart | `CartSummary` |
| `clear_cart` | none | `clearCart` | `CartSummary` |
| `checkout` | none | starts checkout (see Checkout) | `{ ok: true }` or a recovery message |

- Parameter `id` is an enum of every variant id, generated from `menu.json`.
- Recovery messages are short and offer a next step:
  - **Unknown id:** "That's not on the menu. Close matches: …"
  - **Sized item without a size:** "Pepperoni comes in medium or large. Which one?"
  - **Item not in the cart** (for `set_quantity` or `remove_item`): "That isn't in the cart. The cart has: …"
  - **Checkout with an empty cart:** "The cart is empty."
- `find_menu_items` highlights stay until the next search or until the customer scrolls or clicks a card.
- `add_items` checks every line before adding any. If one id is unknown, nothing is added and the recovery message names the bad line.

### Suggestions and group orders

- **"What goes well with X?"** The agent answers from X's `pairsWith`, then calls `show_suggestions` with those items so they appear on screen.
- **"What do you recommend?"** The agent picks from items tagged `popular` and shows them the same way.
- **Group orders** ("I've got a party of 20"):
  1. The agent asks one short question at most, about preferences ("Any vegetarians, or anyone who likes it spicy?"). Then it plans with `serves`. It aims for roughly one serving per person from mains, plus sides and drinks, mixing popular items with what the customer asked for.
  2. It calls `show_suggestions` with the plan, a title like "Party of 20", and a one-line reason. It says the total from the tool result.
  3. It adds the plan with `add_items` only after the customer agrees ("yeah, add all that"). Or the customer taps **Add all**.
  4. Changes before agreeing ("swap one pepperoni for a veggie") update the card with another `show_suggestions` call.

## Agent instructions (first draft)

Greeting: "Hey, welcome to Nick's Pizza! What can I get started for you?"

```text
You work the counter at Nick's Pizza, a classic neighbourhood pizzeria. You're friendly and quick, like someone who's done this a thousand times.

Keep every reply to one or two short sentences. This is a voice conversation: no lists, no markdown, and say prices the way people do ("eighteen ninety-nine").

You only know this menu: {{MENU}}

Rules:
- To change the cart, always use a tool. Never claim you added, changed or removed something unless the tool returned it.
- After each change, confirm it with the quantity, size and name, then the new total from the tool result.
- If a sized item has no size, ask which size before adding it.
- Use find_menu_items when the customer asks what you have that matches something ("vegetarian", "spicy", "under ten bucks"), so the matching items light up on screen. Then name two or three of them.
- When you suggest specific items, call show_suggestions so they appear on screen, and keep your spoken answer short: the screen shows the details.
- When asked what goes with something, answer from its pairsWith. When asked for a recommendation, pick from popular items.
- For a group, ask at most one question about preferences, then plan with each item's serves count: about one serving per person from mains, plus sides and drinks. Show the plan with show_suggestions, say the total, and add it with add_items only after they agree.
- Offer one pairing on your own at most once per order, after the first item is added. When the customer asks for suggestions, always help.
- If asked about something not on the menu, say you don't have it and offer the closest thing you do have.
- If the conversation goes off topic, answer in one friendly line and steer back to the order.
- The customer can also change the cart by tapping. Before answering anything about what's in the cart or the total, call view_cart and answer from its result.
- When the customer is done, read back the order and total from view_cart, then call checkout when they confirm.
```

`{{MENU}}` is filled in from `menu.json` when the session starts. The instructions live in their own module, next to the tool definitions.

## Voice session

- Connection settings (listen model, think provider and model, speak voice) use whatever Deepgram's current docs recommend for a low-latency voice agent. Write the chosen values into this file under Decisions once picked.
- The talk button connects on press. Pressing it again, or leaving the page, ends the session.
- Live captions above the button show the customer's last line and the agent's current reply. This makes it clear what the agent heard.
- The session ends on its own after 60 seconds with no speech from either side.

### The agent always works from the current cart

The customer can change the cart by clicking at any time, including mid-conversation. The agent must never answer from a stale cart:

1. A session starts with the current cart summary in the agent's instructions.
2. While a session is open, every click that changes the cart sends the agent a short context update ("Customer added 1 × Fries by tapping. Cart: …"). Use the Voice Agent API's message for updating context mid-session; check the current docs for which one.
3. The agent calls `view_cart` before answering anything about what's in the cart or the total. The tool reads the live cart, so the answer is right even if an update was missed.

Check: add fries by clicking while a session is open, then ask "what's my total?" The answer includes the fries.

## Checkout

1. The `checkout` tool, or the Checkout button in the cart drawer, calls the server function `createCheckoutSession({ cartDetails })`.
2. The server runs `validateCartItems(products, cartDetails)`, then `stripe.checkout.sessions.create` with `mode: 'payment'`, the validated line items, and:
   - `success_url`: `<origin>/order/success?session_id={CHECKOUT_SESSION_ID}`
   - `cancel_url`: `<origin>/?checkout=cancelled`
3. The server returns `{ url }`. A validation failure returns a message, which the tool passes back to the agent.
4. From voice, the agent says "Taking you to checkout now." Once it finishes speaking, the client closes the voice session and calls `redirectToCheckout(url)`.
5. The success page says the order was received (test mode), shows the order number from the session, and clears the cart. The cancelled state shows a small notice, and the cart stays as it was.

Test card: `4242 4242 4242 4242`, with any future date and any CVC.

## Screens

One page plus the success page. A classic pizzeria feel: cream background, red and white checkered accents, a bold serif heading. Visual design will be refined over time. Keep styles in one place so changing them later is easy.

```text
┌─────────────────────────────────────────────┐
│ NICK'S PIZZA                      [Cart (3)] │
│ Pizza · Subs · Wings · Burgers · Salads · …  │  category links, scroll to section
├─────────────────────────────────────────────┤
│ ┌────────┐ ┌────────┐ ┌────────┐            │
│ │Pepperoni│ │Cheese  │ │White   │            │  cards: name, description, tags,
│ │M ▢ L ▣ │ │M ▣ L ▢ │ │M ▣ L ▢ │            │  size picker, price, [Add]
│ │$20.99 + │ │$15.99 + │ │$18.99 + │          │  highlighted when find_menu_items matches
│ └────────┘ └────────┘ └────────┘            │
│                    …                         │
│                                              │
│        "add two large pepperonis"            │  live captions
│        ( 🎤  Listening… )                    │  talk button, fixed bottom centre
└─────────────────────────────────────────────┘
Cart drawer (slides in from the right): lines with − / + and remove, total, [Checkout]
```

The cart drawer opens on its own the first time a voice change adds an item, so the change is visible.

**Suggestion card.** `show_suggestions` slides a card up above the talk button. It's a sheet, not a blocking modal: the menu stays visible behind it, and the conversation keeps going.

```text
        ┌───────────────────────────────────┐
        │ Party of 20                    ✕  │
        │ Mix of favourites, two veggie pies │  reason
        │ 4 × Large Pepperoni Pizza  [Add]  │
        │ 2 × Large Veggie Supreme   [Add]  │
        │ 3 × Buffalo Wing Dings 12  [Add]  │
        │ …                                 │
        │ Total $214.40        [ Add all ]  │
        └───────────────────────────────────┘
                ( 🎤  Speaking… )
```

- Each line shows the item's name, size, quantity and price. **Add** adds that line. **Add all** adds every line with the same logic as `add_items`.
- The card closes on ✕, after **Add all**, or when the agent shows a new set of suggestions (the new set replaces it).
- A small pairing suggestion (one or two items) uses the same card.

**Phones.** The layout works from 360 px wide up:
- Menu cards stack in one column.
- The cart drawer becomes a full-screen sheet.
- The suggestion card spans the screen width above the talk button.
- The talk button stays reachable with a thumb and never covers the cart's Checkout button.

Test the golden path at phone width in the browser's device mode as well as at desktop width.

**Images.** Each menu item has a real food photo, stored in the repo under `public/images/` and never linked from another site. The rules:
- Use only Unsplash or Pexels photos. Check the license page when downloading to confirm it still allows free commercial use.
- Skip photos with visible logos, brand packaging or recognisable people.
- Record every photo in `CREDITS.md`: item, photographer, source URL and license.
- Resize to about 800 px wide and compress before committing.

## Setup

`.dev.vars.example`, committed:

```text
DEEPGRAM_API_KEY=
STRIPE_SECRET_KEY=sk_test_
```

- Deepgram: create an API key in the Deepgram console. The server uses it only to mint short-lived tokens.
- Stripe: use a test mode secret key (`sk_test_…`). The server rejects any key that doesn't start with `sk_test_`.
- `README.md` covers what the template does, a screenshot or GIF, the stack, setup (clone, `pnpm install`, copy `.dev.vars.example` to `.dev.vars`, `pnpm dev`), how to make it your own shop (edit `menu.json`, swap images, adjust the agent's instructions), and deploying (`wrangler secret put` for both keys, then `pnpm run deploy`). Keep it accurate as each build step lands.
- The README's deploy section warns that the token server function has no rate limit or authentication, so anyone hosting it publicly should add one first.

## Build order

Finish each step, and pass its check, before starting the next.

1. **Scaffold.** TanStack Start on Cloudflare Workers, with lint, typecheck, tests and `pnpm check`. Check: `pnpm check` passes, and `pnpm build` then `wrangler deploy --dry-run` succeeds.
2. **Menu and cart, no voice.** `menu.json`, the product list, images with `CREDITS.md`, menu cards, the cart drawer and `CartProvider`. Check: everything on the golden path works with clicks, at desktop and phone width.
3. **Checkout.** The server function and success and cancelled states. Check: clicking Checkout reaches Stripe test mode, paying with the test card lands on the success page, and the cart is empty.
4. **Voice, no tools.** The token server function, the talk button with all states, and captions. Check: you can talk to the agent about the menu, and the session closes when expected.
5. **Tools.** All tools, tested as plain functions, plus highlighting from `find_menu_items`, the suggestion card and the cart updates sent to the agent. Check: the golden path works by voice. A cart change made by clicking mid-session shows up in the agent's next answer about the cart. "What goes well with the cheeseburger?" shows its pairings on the card. "I have a party of 20, what do you recommend?" shows a plan that feeds about 20, and saying "add all of that" puts it in the cart.
6. **Rough edges.** A denied microphone, a failed token, a dropped connection, and an empty cart at checkout. Check: each one shows a clear message and nothing gets stuck.

## Decisions

Record decisions made during the build here (voice settings, library choices, anything this file left open), with one line on why.

- **TypeScript pinned to `~6.0.3`.** typescript-eslint 8.x supports only `typescript <6.1.0`; TypeScript 7 would break linting.
- **`compatibility_date` is `2026-11-08`.** The workerd bundled with `@cloudflare/vite-plugin` refuses newer dates, so `pnpm dev` would not start.
- **Secret names are listed in `wrangler.jsonc` under `secrets.required`.** Names only, never values. `wrangler types` then gives the same output with or without `.dev.vars`, and deploy fails until both secrets are set.
- **Generated files are committed** (`src/routeTree.gen.ts`, `worker-configuration.d.ts`), so `pnpm check` works on a fresh clone without running dev or `wrangler types` first.
- **Vitest has its own `vitest.config.ts`** without the Cloudflare or Start plugins: tool handlers and other logic are tested as plain Node functions.
- **Lint, typecheck and tests use ESLint, TypeScript and Vitest.** ESLint runs a flat config with `@eslint/js`, `typescript-eslint` and `eslint-plugin-react-hooks`. Step 1 requires all three checks and these are the TanStack and Vite defaults, but they sit outside the AGENTS.md stack table, so the owner should confirm them, together with `@types/node` (Node types for `nodejs_compat` code and config files) and `@vitejs/plugin-react` (required by TanStack Start's Vite setup).
- **`observability.enabled: true` in `wrangler.jsonc`.** Workers logs are on so a deployed copy can be debugged from the dashboard; it's the Cloudflare template default.
- **Currency and locale live in `src/shop.ts`** (`CURRENCY`, `LOCALE`). `CartProvider`, the product list and `formatPrice` all read them, so a shop in another currency edits one file and server and browser format prices alike.
- **No formatter in `pnpm check`.** Step 1 asks for lint, typecheck and tests only, and Prettier or Biome would be another dependency outside the stack table. Add one if the owner wants it.
- **Categories live in `src/menu/menu.ts`.** SPEC fixes `menu.json` as a list of items; `categories` sits next to it and defines which category ids exist and how they're shown (order, label, note).
- **Menu cards start on the size that feeds the most people** (Large, 12 pc), via `defaultVariant`: the common order is one tap away; the SPEC sketch's mixed defaults were illustrative.
- **Clicks share the voice tools' cap of 20 per line** (`MAX_LINE_QUANTITY` in `src/shop.ts`): Add and + stop at 20, so a line the agent reads back never exceeds what its tools accept.
- **use-shopping-cart is pinned to `4.0.0-rc.2`.** pnpm 12's minimum release age blocked rc.3, published hours before step 2; bump it once pnpm allows.
- **Photos are found by item id** (`public/images/<item-id>.jpg`, via `imagePath`), so the SPEC's `MenuItem` shape needs no image field.
- **Sized product names put the size first:** variant labels are `Medium`/`Large` and `6 pc`/`12 pc`, and the product is "Large Pepperoni Pizza" or "12 pc Buffalo Wing Dings". One rule, in `productFor`.
- **A click on Add doesn't open the drawer.** The button says "Added ✓" and the badge updates; SPEC opens the drawer on its own only for voice changes.
- **The drawer is a custom sheet, not a native `<dialog>`.** While it's open only the page wrapper is `inert`, so the step 4 talk button can live outside it and stay usable mid-conversation. Open/closed is the cart library's `shouldDisplayCart`.
- **System font stacks, no web fonts.** A bold serif stack for headings and a sans stack for text keep the page free of third-party requests.
- **The Stripe client is built with `httpClient: Stripe.createFetchHttpClient()`.** Stripe's docs and README say nothing about Workers. stripe@23's `workerd` export already defaults to fetch, and Cloudflare's own Stripe guide passes the fetch client, so passing it explicitly keeps the code working whichever build gets resolved.
- **Checkout reads only ids and quantities from the posted cart** (`src/checkout/checkout.ts`). It checks each line (on the menu, quantity 1–20) before `validateCartItems`, so the message can name the line. Passing only ids and quantities also keeps out the browser's `product_data.metadata`, which `validateCartItems` would otherwise copy (see `LIBRARY_FEEDBACK.md`).
- **Stripe's return urls use the request's own origin** (`getRequest().url`), not `x-forwarded-*` headers, so local dev and every deployed hostname work without configuration.
- **The order number is the last 8 letters and digits of the Checkout Session id, uppercased** (`orderNumber`). The success page already has the id in its url, so showing the number takes no Stripe call. It's for people to read; the full id finds the order in the dashboard.

## Open questions

- Should the agent offer a daily special? That would need a `specials` source.
- Should captions keep a scrollable history, or show only the latest exchange?
