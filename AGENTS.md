# deepgram-pizza

A small template: talk to a pizza shop. A voice agent answers menu questions, edits the cart through tool calls, and sends the customer to Stripe Checkout. Developers clone it to put voice on their own shop.

Keep the UI simple and the code clear enough to copy.

What to build, and in what order, is in `SPEC.md`: the menu, the tools, the agent's instructions, the screens and the build steps. Read it before starting a step, and record decisions in its Decisions section.

## The golden path

This conversation is the product. Every change keeps it working:

1. Press the talk button.
2. "What's vegetarian?" The agent answers from the menu.
3. "Add two large margheritas." The cart badge and drawer update while the agent confirms out loud.
4. "Actually, make that one." The quantity changes.
5. "What's my total?" The agent reads the total from the cart.
6. "Check out." The browser lands on Stripe Checkout in test mode.

Work is done when the golden path runs end to end in a browser with your change in it. Say which steps you ran and what you saw.

## Stack

| Piece | Choice | Read first |
|---|---|---|
| App | TanStack Start (React) | https://tanstack.com/start/latest |
| Hosting | Cloudflare Workers, through `@cloudflare/vite-plugin` and Wrangler | https://tanstack.com/start/latest/docs/framework/react/guide/hosting |
| Voice | Deepgram Voice Agent: `@deepgram/react` (`AgentProvider`, `useAgentClientTool`) | https://developers.deepgram.com/docs/browser-agent-react |
| Cart | `use-shopping-cart@next` (v4 release candidate) | https://useshoppingcart.com/docs |
| Checkout | Stripe Checkout, test mode only | https://docs.stripe.com/checkout/quickstart |

These APIs change faster than your training data. Read the current docs before writing integration code, and match the version installed in `node_modules`. Deepgram's index is https://developers.deepgram.com/llms.txt, and adding `.md` to any Deepgram doc URL returns Markdown.

Add a dependency outside this table only after asking.

## Architecture

- **The cart lives in the browser, and so do the tools.** The agent asks for a tool. A browser handler registered with `useAgentClientTool` calls a use-shopping-cart action. The agent never changes the cart any other way.
- **The server does two things:** it mints the short-lived Deepgram token, and it creates the Stripe Checkout Session. Each is a TanStack Start server function. Anything else on the server needs a clear reason.
- **`menu.json` is the single source of truth.** The menu UI, the agent's instructions, the tool parameter enums and the checkout validation all read the same file. Each size is its own product with its own id (`margherita-large`), so a tool call never carries a size to interpret.
- **Every cart tool returns the cart.** After a change, the handler returns the updated cart summary (lines, count, formatted total). The agent speaks only from what tools return, so it never invents a price or a total.
- **Tools recover; they don't throw.** An unknown id or a bad quantity returns a short message the agent can act on ("No 'hawaiian'. The pizzas are: …"). A thrown error ends the turn in silence.
- **Keep the tools few and literal.** Name each one after the customer's intent. The tool list is in `SPEC.md`; add a tool only when it changes state or changes the screen.

## Voice

- Open the Deepgram connection only when the customer presses the button, and close it when they stop or leave the page. A connection that stays open costs money every second.
- Show every agent state on the button: idle, connecting, listening, thinking, speaking, error. A voice UI that looks frozen reads as broken.
- The browser gets a token from our server function on every connect. The server mints it through Deepgram's `/v1/auth/grant`. The API key stays on the server.
- Agent instructions: a friendly counter worker at a fictional shop. Keep answers to one or two sentences. Confirm each change out loud with quantity, size and name. Ask when a request is ambiguous ("Large or medium?"). Talk about this menu and nothing else.
- Ask for the microphone on the first press, not on page load, and handle a denied permission with a visible message.

## Cloudflare Workers

- The runtime is workerd, not Node. Before adding a package, check that it runs on Workers. `nodejs_compat` covers part of Node, not all of it.
- Read secrets with `import { env } from "cloudflare:workers"` inside server functions.
- Secrets: `DEEPGRAM_API_KEY` and `STRIPE_SECRET_KEY`. Locally they live in `.dev.vars`, which stays out of git. In production, set them with `wrangler secret put <KEY>`. Values go in neither `wrangler.jsonc` `vars` nor client code.
- After changing bindings, run `wrangler types`. To check a deploy without publishing, run `pnpm build`, then `wrangler deploy --dry-run`. Leave out `--config`, because the plugin generates the deploy config.
- Before calling Stripe from a Worker, confirm how Stripe's current docs say to use their SDK on Workers.

## use-shopping-cart

- In components, read state through selectors: `useShoppingCart((cart) => cart.cartCount)`. Tool handlers call actions from `useShoppingCart()`.
- Checkout: the client posts `cartDetails` to the checkout server function. The server rebuilds the line items with `validateCartItems(menu, cartDetails)` from `use-shopping-cart/utilities`, creates the session, and returns `session.url`. The client then calls `redirectToCheckout(url)`. Prices come from `menu.json` on the server, never from the browser.
- use-shopping-cart v4 is a release candidate. When it surprises you, write it down in `LIBRARY_FEEDBACK.md` so it can be reported upstream: a bug, a confusing doc, or an API that fought you. Record what you expected, what happened, and the workaround. Then continue.

## Scope

v1 has the golden path and the parts that support it: a menu page, a cart drawer, the talk button, the tools and test-mode checkout.

Later, not v1: accounts, delivery addresses, toppings and other customization, order history, payments outside test mode, and a CMS for the menu. Keeping the menu in one JSON file is what makes the CMS swap easy later.

Evals are planned: checking that the agent picks the right tool with the right arguments. Don't build them yet. Keep the tool definitions and the agent instructions in their own modules, so evals can import them later.

The shop is fictional.

## Verifying

- Once the app is scaffolded, `pnpm check` runs lint, typecheck and tests. Keep it passing, and wire every new kind of check into it.
- Test tool handlers as plain functions: given a cart and arguments, assert the action called and the summary returned. That covers the logic voice can't exercise in a headless run.
- Voice itself needs a human with a microphone. Run the golden path in a real browser, or say plainly that you couldn't and which steps are still unverified.

## Licensing

- The code is MIT (`LICENSE`). Photos keep their own licenses and are listed in `CREDITS.md`.
- Add an image only from a source whose license allows free commercial use (Unsplash or Pexels), and record it in `CREDITS.md` in the same change.

## Working agreements

- Leave `git init` and pushing to the owner. Commit only when asked.
- When a request conflicts with this file, say so before acting.
- Keep this file current. When a rule here turns out wrong or a new gotcha costs time, update this file in the same change.
