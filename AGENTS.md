# deepgram-pizza

A small template: talk to a pizza shop. A voice agent answers menu questions, edits the cart through tool calls, and sends the customer to Stripe Checkout. Developers clone it to put voice on their own shop.

Keep the UI simple and the code clear enough to copy.

What to build, and in what order, is in `SPEC.md`: the menu, the tools, the agent's instructions, the screens and the build steps. Read it before starting a step, and record decisions in its Decisions section.

## The golden path

This conversation is the product. Every change keeps it working:

1. Press the talk button. The agent asks pickup or delivery (or confirms the earlier choice); say "Delivery." It answers "Great, delivery it is. What can I get you?" The cart's switch shows Delivery.
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
- **Every cart tool returns the cart.** After a change, the handler returns the updated cart summary (lines, count, formatted total, and the total as words to say, `totalSpoken`; for delivery, also `delivery`: the fee and the total with it, written and spoken). The agent speaks only from what tools return, so it never invents a price or a total.
- **Tools recover; they don't throw.** An unknown id or a bad quantity returns a short message the agent can act on ("No 'hawaiian'. The pizzas are: …"). A thrown error ends the turn in silence.
- **Keep the tools few and literal.** Name each one after the customer's intent. The tool list is in `SPEC.md`; add a tool only when it changes state or changes the screen.

## Voice

- Open the Deepgram connection only when the customer presses the button, and close it when they stop or leave the page. A connection that stays open costs money every second.
- Show every agent state on the button: idle, connecting, listening, thinking, speaking, error. A voice UI that looks frozen reads as broken. While the SDK reconnects a dropped connection the status is connecting again and the button says "Reconnecting…" (`reconnecting` on the live session, `src/voice/sessionStatus.ts`); the SDK gives up after eight tries (a minute and a half, more when tries hang), and the session ends with "We lost the connection. Press to talk again." Every way a session fails ends in a message: add a new one to `updateSession` with its test, never a silent return to idle.
- The browser gets a token from our server function on every connect. The server mints it through Deepgram's `/v1/auth/grant`. The API key stays on the server. The grant needs a key with Member permissions or higher; a lesser key gets `403 FORBIDDEN "Insufficient permissions."`, and the talk button shows "Voice isn't available right now".
- Agent instructions: a friendly counter worker at a fictional shop. Keep answers to one or two sentences. Confirm each change out loud with quantity, size and name. Ask when a request is ambiguous ("Large or medium?"). Talk about this menu and nothing else.
- Ask for the microphone on the first press, not on page load, and handle a denied permission with a visible message.
- `AgentProvider` reads `config` only on its first render, so the voice session mounts a new provider (new `key`) on every press with the config built at that moment (`src/voice/VoiceSession.tsx`).
- Deepgram doesn't send `AgentStartedSpeaking` any more, and sent no `AgentThinking` in our sessions, though `@deepgram/agents` still lists both events. Know the agent is speaking from the SDK's mode (it follows the audio), and check the session log on `/dev/tools` for which messages actually arrive before relying on one.
- In development every session is recorded in the session log on `/dev/tools` (`src/dev/`): what was said, and every Deepgram message but the audio. Read it, or copy it as text or JSON, when checking or reporting voice behaviour. Code that records it loads only behind `import.meta.env.DEV`.
- In development TanStack Start renders the app inside `<StrictMode>`, so effects mount, unmount and mount again. An effect that starts something once (a connection, a log section) has to survive that.
- In `pnpm dev`, saving `src/agent/handlers.ts` or `src/agent/cartChanges.ts` hot-updates the page without reloading it, but the page keeps the tool handlers and cart changes it made when it loaded: each provider holds its set in `useState`, which Fast Refresh keeps. Tool calls (and, after an edit to `cartChanges.ts`, taps) run the old code until you reload the page, which also ends any voice session; if a fake microphone's stream was stopped with the old session, hand the new session a fresh one. The edit doesn't make `useToolHandlers` throw: the contexts live in `src/pageContext.ts`, which imports only types, so hot updates leave them alone.
- The agent says "Let me put something together." as a plan starts because the app sends it (Deepgram's `InjectAgentMessage`, queued: `SAID_WHEN_CALLED` in `src/agent/tools.ts`, sent by `src/voice/ClientTools.tsx`), not because a rule asks the LLM to. When a line has to be said word for word at a moment the app knows, send it this way; the LLM drifts from wording in its rules.
- The agent's instructions are written when the customer presses the talk button and never rewritten. Whatever changes afterwards that a rule depends on has to be told to the agent with `tell` (an `UpdatePrompt`), not left to the conversation: a choice of pickup or delivery made by voice goes through `useCartChanges().chooseOrderType(type)` for that reason (the `set_order_type` handler's `orderType.set` port), after the agent asked "Pickup or delivery?" a second time.
- Taps reach the agent through the page's cart changes, which carry every tap the agent hears, cart or order type: `useCartChanges().tap(change)` for the cart and `tapOrderType(type)` for Pickup or Delivery (see "use-shopping-cart"). Both call `useVoiceSession().tell(text)` (an `UpdatePrompt`); voice checkout leaves through `leaveAfterSpeaking()`. Both are safe without a session. The page's shared contexts and their hooks live in `src/pageContext.ts`, which imports only types; keep it that way, so `src/agent/` never imports `src/voice/`.
- A new tool needs four things, and `pnpm typecheck` fails until it has them all: its definition in `toolDefinitions` (`src/agent/tools.ts`), its handler in `createToolHandlers` (`src/agent/handlers.ts`), an activity label in `TOOL_ACTIVITY` (`src/voice/AgentActivity.tsx`) and example arguments in the dev panel's `examples` (`src/dev/ToolsPanel.tsx`). `pnpm test` also wants its name in the list in `src/agent/tools.test.ts`, which mirrors SPEC's Tools table. Add a rule to `src/agent/instructions.ts` only when the agent needs telling when to call it. A tool that changes state, reads the cart, or leaves the page, also sets `defer_until_eot: true`, so Deepgram calls it only once the customer has finished talking (a read that didn't wait would run before a deferred change in the same turn); `src/agent/tools.test.ts` lists which tools do. The voice wiring needs nothing: every definition is registered with each session (`src/voice/ClientTools.tsx`) and sent as the agent's functions.

## Cloudflare Workers

- The runtime is workerd, not Node. Before adding a package, check that it runs on Workers. `nodejs_compat` covers part of Node, not all of it.
- Read secrets with `import { env } from "cloudflare:workers"` inside server functions.
- Secrets: `DEEPGRAM_API_KEY` and `STRIPE_SECRET_KEY`. Locally they live in `.dev.vars`, which stays out of git. In production, set them with `wrangler secret put <KEY>`. Values go in neither `wrangler.jsonc` `vars` nor client code.
- To check a deploy without publishing, run `pnpm build`, then `wrangler deploy --dry-run`. Leave out `--config`, because the plugin generates the deploy config.
- Before calling Stripe from a Worker, confirm how Stripe's current docs say to use their SDK on Workers. As of stripe@23 they say nothing about Workers; the package ships a `workerd` build that uses fetch, and we also pass `httpClient: Stripe.createFetchHttpClient()` explicitly, as Cloudflare's guide does.
- `compatibility_date` can't be newer than what the workerd bundled with `@cloudflare/vite-plugin` supports; `pnpm dev` refuses to start otherwise. Bump it only together with the plugin.
- `worker-configuration.d.ts` and `src/routeTree.gen.ts` are generated and committed, so `pnpm check` works on a fresh clone. After changing bindings or secrets in `wrangler.jsonc`, run `pnpm cf-typegen` (`wrangler types`) and commit the result. After adding or renaming a route, run `pnpm dev` or `pnpm build` once so the route tree regenerates, and commit it. Secret names are listed under `secrets.required` in `wrangler.jsonc` (names only).
- `vite build` copies `.dev.vars` into `dist/server/`, so `dist/` must stay ignored.

## use-shopping-cart

- In components, read state through selectors: `useShoppingCart((cart) => cart.cartCount)`.
- On the menu page, change the cart through the page's cart changes (`src/agent/cartChanges.ts`), not with a use-shopping-cart action. A tap calls `useCartChanges().tap(change)` with a `CartChange` (`{ type: 'add', lines: [{ id, quantity }] }`, `quantity`, `remove` or `clear`), and Pickup or Delivery in the drawer calls `tapOrderType(type)`; the tool handlers get the same object as their cart port (`now()`, `change(change)`, and `cartDetails()` for checkout). It runs the action, returns the summary of the cart after it, and on a tap also tells the agent, so no tap can leave the agent with a stale cart. It checks nothing: check ids and quantities first (lines to add with `checkLinesToAdd` from `src/agent/handlers.ts`).
- The cart drawer is an order board (`src/components/orderBoard.ts`): it learns of changes from `useCartChanges().subscribe`, so a change made any other way (a use-shopping-cart action called directly) shows at once without keying in. Another reason to change the cart only through the cart changes.
- Select actions the same way as state: `useShoppingCart((cart) => cart.addItem)`, so a component doesn't re-render on every cart change. To open the drawer from code, call `handleCartHover()`; `handleCartClick()` toggles and `handleCloseCart()` closes. See `LIBRARY_FEEDBACK.md`.
- Code can't read the cart back right after calling an action: the hook shows the new cart only after the next render, and has no `getState()`. So the cart changes work out the cart after each change themselves (`applyCartChange` in `src/agent/cartSummary.ts`), and remember it until `cartDetails()` changes, since several tool calls, or a tap and a tool call, can come before React renders. `src/agent/cartChanges.test.ts` checks this against a real core `ShoppingCart`. Code that needs the cart right after a change reads `now()`, or the summary `change()` or `tap()` returned.
- Checkout: the client posts `cartDetails` and `orderType` (`pickup` or `delivery`) to the checkout server function. The server re-checks the type with `isOrderType` before calling Stripe (without one it answers "Choose pickup or delivery first."), keeps only each line's id and quantity (`{ [id]: { quantity } }`), rebuilds the line items with `validateCartItems(products, …)` from `use-shopping-cart/utilities`, creates the session, and returns `session.url`. Passing the posted `cartDetails` straight through would let the browser's `product_data.metadata` reach Stripe (see `LIBRARY_FEEDBACK.md`). The client then calls `redirectToCheckout(url)`. Prices come from `menu.json` on the server, never from the browser.
- use-shopping-cart v4 is a release candidate. When it surprises you, write it down in `LIBRARY_FEEDBACK.md` so it can be reported upstream: a bug, a confusing doc, or an API that fought you. Record what you expected, what happened, and the workaround. Then continue.

## Scope

v1 has the golden path and the parts that support it: a menu page, a cart drawer, the talk button, the tools and test-mode checkout, for pickup or delivery. Delivery addresses are in v1 since the owner chose it on 2026-11-10: Stripe Checkout collects them (US only), never the agent by voice.

Later, not v1: accounts, toppings and other customization, order history, payments outside test mode, and a CMS for the menu. Keeping the menu in one JSON file is what makes the CMS swap easy later.

Evals are planned: checking that the agent picks the right tool with the right arguments. Don't build them yet. Keep the tool definitions and the agent instructions in their own modules, so evals can import them later.

The shop is fictional.

## Verifying

- Once the app is scaffolded, `pnpm check` runs lint, typecheck and tests. Keep it passing, and wire every new kind of check into it.
- Test tool handlers as plain functions: given a cart and arguments, assert the change asked for and the summary returned. That covers the logic voice can't exercise in a headless run.
- Vitest runs in Node, which has no `cloudflare:workers`. A test that imports the route tree (or anything that reaches a server function) must `vi.mock('cloudflare:workers', () => ({ env: {} }))`, as `src/router.test.ts` does. Keep pure logic out of server-function files so most tests don't need the mock.
- To check 360 px when the browser window can't be resized, load the page in a same-origin `<iframe src="/" style="width:360px;height:740px">`; media queries follow the frame's width. Stripe's hosted Checkout won't render inside a frame, so pay with the test card at desktop width and check our own pages (drawer, success, cancelled) in the frame.
- To check a failure in the browser, force it from the page before pressing the talk button: make `navigator.mediaDevices.getUserMedia` reject with `new DOMException('Permission denied', 'NotAllowedError')` for a denied microphone; wrap `window.fetch` to reject calls to `/_serverFn/` for a token or a checkout that can't be reached; wrap `window.WebSocket` to keep each Deepgram socket, and call `close()` on the live one for a dropped connection (send new ones to `ws://127.0.0.1:1/` to keep it down). The session log on `/dev/tools` shows each reconnect try.
- Voice itself needs a human with a microphone. Run the golden path in a real browser, or say plainly that you couldn't and which steps are still unverified.

## Tooling

- pnpm runs install scripts only for packages allowed in `pnpm-workspace.yaml` `allowBuilds`. When a new dependency needs a build script, add it there with `pnpm approve-builds <pkg>`.
- pnpm 12 normally waits 24 hours before installing a newly published version. That wait is off here (`minimumReleaseAge: 0` in `pnpm-workspace.yaml`) so use-shopping-cart release candidates install the day they ship. Pin exact versions, and look at what a fresh release changed before you install it.

## Licensing

- The code is MIT (`LICENSE`). Photos keep their own licenses and are listed in `CREDITS.md`.
- Add an image only from a source whose license allows free commercial use (Unsplash or Pexels), and record it in `CREDITS.md` in the same change.

## Working agreements

- Leave `git init` and pushing to the owner. Commit only when asked.
- When a request conflicts with this file, say so before acting.
- Keep this file current. When a rule here turns out wrong or a new gotcha costs time, update this file in the same change.
