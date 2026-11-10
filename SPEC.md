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

- Deepgram: create an API key in the Deepgram console with Member permissions or higher (`/v1/auth/grant` refuses lesser keys with a 403). The server uses it only to mint short-lived tokens.
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
- **use-shopping-cart is pinned to `4.0.0-rc.3`, and pnpm installs new releases right away.** pnpm 12 waits 24 hours before installing a newly published version (`minimumReleaseAge`), which held the project on rc.2. The owner turned the wait off with `minimumReleaseAge: 0` in `pnpm-workspace.yaml`, so new release candidates can be tried the day they ship.
- **Photos are found by item id** (`public/images/<item-id>.jpg`, via `imagePath`), so the SPEC's `MenuItem` shape needs no image field.
- **Sized product names put the size first:** variant labels are `Medium`/`Large` and `6 pc`/`12 pc`, and the product is "Large Pepperoni Pizza" or "12 pc Buffalo Wing Dings". One rule, in `productFor`.
- **A click on Add doesn't open the drawer.** The button says "Added ✓" and the badge updates; SPEC opens the drawer on its own only for voice changes.
- **The drawer is a custom sheet, not a native `<dialog>`.** While it's open only the page wrapper is `inert`, so the step 4 talk button can live outside it and stay usable mid-conversation. The panel is `role="dialog"` without `aria-modal`, which would also hide the talk button, captions and voice errors from screen readers; `inert` already keeps the page behind out of reach. Open/closed is the cart library's `shouldDisplayCart`.
- **System font stacks, no web fonts.** A bold serif stack for headings and a sans stack for text keep the page free of third-party requests.
- **The Stripe client is built with `httpClient: Stripe.createFetchHttpClient()`.** Stripe's docs and README say nothing about Workers. stripe@23's `workerd` export already defaults to fetch, and Cloudflare's own Stripe guide passes the fetch client, so passing it explicitly keeps the code working whichever build gets resolved.
- **Checkout reads only ids and quantities from the posted cart** (`src/checkout/checkout.ts`). It checks each line (on the menu, quantity 1–20) before `validateCartItems`, so the message can name the line. Passing only ids and quantities also keeps out the browser's `product_data.metadata`, which `validateCartItems` would otherwise copy (see `LIBRARY_FEEDBACK.md`).
- **Stripe's return urls use the request's own origin** (`getRequest().url`), not `x-forwarded-*` headers, so local dev and every deployed hostname work without configuration.
- **The order number is the last 8 letters and digits of the Checkout Session id, uppercased** (`orderNumber`). The success page already has the id in its url, so showing the number takes no Stripe call. It's for people to read; the full id finds the order in the dashboard.
- **The order page clears the cart whenever its url has a `session_id`, without asking Stripe if it was paid.** Stripe sends customers there only after paying, and a hand-typed url can only empty the visitor's own cart. Without a `session_id` it says there's no order to show and leaves the cart alone.
- **The order page has a small header of its own** (the brand, linking home) instead of `SiteHeader`: the cart it would open was just emptied, and its category links point at sections on the menu page.
- **The Checkout button stays pending until the browser leaves for Stripe**, and clicks while pending do nothing, so a second click can't start a second session. It's `aria-disabled`, not `disabled`, so it keeps focus and screen readers hear "Taking you to checkout…". It resets on `pageshow` when the browser's Back button restores the page from the back/forward cache.
- **Tests that load the route tree mock `cloudflare:workers`** (`src/router.test.ts`): routes reach the server functions, which import it, and only workerd has that module.
- **The tools live in `src/agent/`:** `tools.ts` (definitions), `handlers.ts` (`createToolHandlers(ports)`, plus `addLines` for Add all), `cartSummary.ts`, `menuSearch.ts`, `tapUpdates.ts`, all free of React and the server. Handlers reach the cart, the screen and checkout only through injected ports, so tests run them against a real core `ShoppingCart` and evals can import them. The React wiring sits beside them in `.tsx` files: `MenuUiProvider`, `ToolHandlersProvider`, `TapUpdatesProvider`.
- **Handlers work out the cart after their change themselves** and summarize that, since a React component can't read the cart back right after an action (see `LIBRARY_FEEDBACK.md`). The arithmetic is written once, as `CartChange` and `applyCartChange` in `cartSummary.ts`, and tap updates use it too; it only adds and subtracts, so callers check ids and quantities first. Tests check every handler summary, and each kind of change, against the real store.
- **Several tool calls can run before React re-renders** (Deepgram's `FunctionCallRequest` can carry more than one), while `cartDetails()` still returns the cart from before the first. So the handlers remember the cart their last change worked out, with the `cartDetails()` object it was based on, and use it while `cartDetails()` returns that same object; once a render brings a new object, they trust `cartDetails()` again. Summaries and the 20-per-line cap stay right across a batch. `checkout` reads the rendered cart, since it comes a turn after the customer confirms.
- **Every recovery result is `{ message }`**, the same shape `CheckoutResult` uses. Handlers also take their arguments as the JSON string Deepgram delivers, and a wrapper turns any unexpected error into a message.
- **`set_quantity` and `remove_item` answer an id that isn't in the cart the way SPEC's recovery list does:** an id that isn't on the menu gets what `add_item` would say (close matches, or the size question for a sized item without a size), and an id on the menu but not in the cart gets the cart's lines with their ids, the list the agent needs to retry.
- **Close matches for an unknown id are scored by words:** each word of the id that matches a word in an item's name, id or sizes (equal, a prefix of 4+ letters, or two typos apart for 5+ letters) scores a point, and up to three items with the top score are offered with their variant ids. With no match, the message says nothing is close.
- **`add_items` adds up repeated ids** into one `addItem` call, and the 20-per-line cap counts the sum plus what's in the cart. It checks every line before adding any.
- **`find_menu_items` with no filters returns a message asking for one**, not the whole menu: the agent already has the menu, and lighting up every card says nothing. With `max_price`, only the sizes within it are listed. A query matches when every word appears in the name, description or id.
- **`show_suggestions` checks its lines like `add_items` but not against the cart**, since the cart can change before Add all, which checks again. Repeated ids become one line, a blank title becomes "Suggestions". The card's lines and total come from `summarizeCart`, the one place that prices lines.
- **"Add all of that" by voice closes the suggestion card, as Add all does.** The handlers remember the lines of the last set they showed; when `add_items` succeeds with exactly those lines (same ids and quantities, in any order), they call `closeSuggestions()`, so tapping Add all afterwards can't add the set twice. Any other `add_items` leaves the card open.
- **Tap updates cover add (menu card, Add, Add all), quantity (− and +, with the new quantity) and remove** (`describeTapChange`), each followed by the cart and total. `CartChange` also has `clear`, for the `clear_cart` tool; no tap clears the cart today.
- **Tap updates go to the agent with Deepgram's `UpdatePrompt`.** Its docs (checked 2026-11-10) say it adds to the prompt rather than replacing it; `InjectUserMessage` would make the agent reply and `InjectAgentMessage` would make it speak. Wiring it up is part of the voice half.
- **The page has one set of tool handlers, made by `ToolHandlersProvider` and read with `useToolHandlers()`.** The set remembers whether a voice add has opened the drawer, the suggestions it showed last and a change React hasn't rendered yet, so the talk button and the dev tools panel must share it. It reads the cart through a ref updated after each render; the one `eslint-disable` for `react-hooks/refs` there is because the linter can't see that the getter is only called when a tool runs.
- **The Checkout button and the `checkout` tool share `startCheckout`** (`src/checkout/startCheckout.ts`): the server function's answer, or `CHECKOUT_UNAVAILABLE` when the request fails. It never throws, so the tools' `checkout` port is documented as never rejecting and the handler has no try/catch of its own; the handlers' recovering wrapper still answers if a port breaks that promise. The 1–20 quantity rule is `isLineQuantity` in `src/shop.ts`, shared by checkout and the handlers.
- **Any scroll of the page clears the highlights, except the one that brings the first match into view** (`useHighlightScroll`): the wheel, a touch drag, a scroll key, the scrollbar or a category link all count. Scroll events are ignored from the moment the highlight's own scroll starts until it settles (`scrollend`, or 150 ms without a scroll event where `scrollend` is missing or nothing needed scrolling); without that, the smooth scroll would clear the highlights it meant to show. The first match scrolls to the top, just below the sticky header.
- **The suggestion card lives outside the page wrapper and above the cart (z-index 25).** It stays usable while the cart is open: on wide screens it moves to the space beside the drawer, and below 50rem, where there's no room beside it, it hides until the cart closes, so it never covers the Checkout button. It sits above `--voice-space`, the room kept at the bottom for the talk button and, while they show, its captions or message (`--talk-button-space`, plus `--captions-space` then), and is at most 60% of the screen tall, with its lines scrolling. When it closes (✕ or Add all), focus goes to the cart's close button while the cart is open, since the page behind it is inert, and to the header's cart button otherwise.
- **Add on a suggestion line can be tapped again, and Add all adds every line,** as SPEC says, even ones already added from the card. A note on the card says what each tap added, or why `addLines` refused it.
- **The dev tools panel lives at `/dev/tools` and exists only in dev.** The route's `beforeLoad` throws `notFound()` unless `import.meta.env.DEV`, and the panel (`src/dev/ToolsPanel.tsx`) loads through `lazy()` only when `import.meta.env.DEV` is true, so a production build drops it and its styles. It renders the same `MenuPage` as `/` (`src/components/MenuPage.tsx`), with the panel as a child inside the tool handlers' provider and outside the inert page wrapper, and calls `useToolHandlers()`, never a second handler set. `src/router.test.ts` checks the 404 outside dev.
- **The panel's styles live next to it, in `src/dev/ToolsPanel.css`,** not in `src/styles.css`, so production builds carry none of them. On phones it's a bottom sheet; from 64rem it's docked on the left and the page moves over. Open, it sits above the cart and the suggestion card (z-index 30); collapsed, it's a corner tab under the cart (15), so it never covers the Checkout button.
- **The panel's pairings preset reads the cheeseburger's `pairsWith`, and the party preset's label adds up its mains' `serves`** from `menu.json` (3 large pepperoni, 1 large cheese, 1 large veggie supreme: 20), so the presets show what the menu says rather than numbers typed by hand.
- **Tap updates go to `TapUpdateSinkContext`, which does nothing by default.** The voice session will provide a sink that sends each update to the agent; the dev tools panel can provide one that logs them. `TapUpdatesProvider` reads the cart once for the whole page and works out the cart after the tap with `applyCartChange`, so menu cards don't re-render on every cart change.
- **The agent's instructions and greeting live in `src/agent/instructions.ts`** (`GREETING`, `agentInstructions(cart)`, `describeMenu()`), free of React and Deepgram so evals can import them. `{{MENU}}` is one plain-text line per item under a heading per category, each size as `Large: id cheese-pizza-large, $18.99, serves 4.`, all read from `menu.json`; the prompt is about 8,900 characters. It ends with `Conversation started. Cart: …`, in the words of `describeCart` (`cartSummary.ts`), which the tap updates also use, so the updates sent mid-session read as what happened next.
- **Voice tokens live 30 seconds** (`TOKEN_TTL_SECONDS` in `src/voice/deepgramToken.ts`, sent as `ttl_seconds`). Deepgram's docs (checked 2026-11-10, https://developers.deepgram.com/reference/auth/tokens/grant) make 30 the default and say a token only has to be valid while the socket opens. `@deepgram/agents` asks for a new token before every connect and reconnect, and gives up on opening after 10 seconds, so 30 covers it. The token server function (`getDeepgramToken`) is a POST, so nothing caches a token, and it answers `{ token }` or `{ message }` the way checkout does.
- **The voice session's lifecycle is one reducer, `updateSession` in `src/voice/sessionStatus.ts`,** free of React and the SDK, so tests run it as lists of events. It owns the talk button's status and message and every rule for ending a session; `VoiceSession.tsx` only turns SDK callbacks into events. A disconnect ends the session ("We lost the connection") only once the agent has its settings and the microphone is on. Before that it's `AgentProvider` hanging up after a failed start, and the error it reports a microtask later says why. The microphone counts too because it starts after the connection opens, so when the browser asks for permission the settings usually arrive first, and a denied prompt would otherwise read as a lost connection.
- **The button shows thinking from the end of the customer's turn until the agent starts speaking.** The SDK's mode turns thinking only on Deepgram's `AgentThinking`, which isn't sent every turn, so the button could go straight from listening to speaking. The customer's `ConversationText` (sent at the end of their turn) moves a listening session to thinking in `updateSession`; the agent starting to speak moves it to speaking, and the customer starting again moves it back to listening. A line that arrives after the agent started speaking changes nothing.
- **The session's state lives in `VoiceSessionProvider`, at the top of `MenuPage`,** above `ToolHandlersProvider` and `TapUpdatesProvider`, so step 5's tap updates and voice checkout can reach the live session from there. The talk button, the captions and the per-press `AgentProvider` still render outside the page wrapper an open cart makes inert.
- **The voice agent listens with Flux (`flux-general-en`, `version: 'v2'`), thinks with the Deepgram-managed `open_ai` model `gpt-4.1-mini`, and speaks with Flux TTS (`flux-cole-en`, `version: 'v2'`).** Deepgram's docs (checked 2026-11-10) call Flux "best for low-latency voice agents", with end-of-turn detection built in (https://developers.deepgram.com/docs/voice-agent-stt-models), and Flux TTS "streaming-first, voice-agent-first" (https://developers.deepgram.com/docs/voice-agent-tts-models). They don't recommend an LLM for latency (https://developers.deepgram.com/docs/voice-agent-llm-models); GPT-4.1 mini is a fast managed model that answers without a reasoning step first, and a managed model needs no LLM key or endpoint. All three are set in `agentSettings` (`src/voice/agentSettings.ts`); change the models or the voice there.
- **Captions show only the latest exchange:** the customer's last line and the agent's current reply, as "Voice session" says (`latestExchange` in `src/voice/latestExchange.ts`). The reply is every agent line after the customer's last line, since Deepgram may send a reply as one `ConversationText` or one per sentence; before the customer speaks, it's the greeting. Each line stays its own span, keyed by the line's id, inside the polite live region, so a screen reader hears a new sentence as an addition instead of rereading the reply. The customer's line keeps its first 2 lines; the agent's reply keeps its newest 3, bottom-aligned with the oldest hidden at the top, because the newest sentence is what the agent is saying now. It's the smallest thing that shows what the agent heard, and the box fits the room kept above the talk button. Whether to keep a scrollable history is still an open question for the owner.
- **While the cart is open, the talk button moves into the cart's column, under the Checkout button,** instead of the bottom centre. The voice strip stays fixed at the bottom but takes the cart's width on the right (`width: min(var(--drawer-width), 100%)`), and the cart's footer keeps `--voice-space` free below Checkout, growing while captions or a message show. The button stays usable mid-conversation, since it sits above the cart and outside the page wrapper the cart makes inert, and it never covers Checkout.
- **The agent's settings are built when the customer presses the talk button, and each press mounts its own `AgentProvider`** (a new `key`, in `src/voice/VoiceSession.tsx`). `AgentProvider` reads `config` only on its first render and ignores later changes, and the instructions have to carry the cart as it is at the press. Ending the session unmounts the provider, which hangs up and stops the microphone; with no session there's no provider, so nothing connects or asks for the microphone until a press.

## Open questions

- Should the agent offer a daily special? That would need a `specials` source.
- Should captions keep a scrollable history, or show only the latest exchange?
