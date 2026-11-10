# use-shopping-cart feedback

Surprises we hit with use-shopping-cart v4 (release candidate) while building this template, written so they can be reported upstream. Version used: `4.0.0-rc.2`.

## The migration guide's install tag doesn't exist

- **What I expected:** "Migrating to v4.0" says v4 is a release candidate at `use-shopping-cart@rc`, so `pnpm add use-shopping-cart@rc` should install it.
- **What happened:** npm has no `rc` dist-tag (`No matching version found for use-shopping-cart@rc`). The tags are `latest` (3.2.0), `next` (4.0.0-rc.x), `alpha` and `beta`.
- **Workaround:** `pnpm add use-shopping-cart@next`.

## No documented way to get an action without re-rendering on every cart change

- **What I expected:** a way for a component to call `addItem` without subscribing to the whole cart. Each of the 30 menu cards needs `addItem`, and none of them should re-render when an unrelated line changes.
- **What happened:** `useShoppingCart()` with no selector returns state and actions together, so the component re-renders on every change. The docs show selectors only for state (`(cart) => cart.cartCount`), in the migration guide.
- **Workaround:** select the action: `useShoppingCart((cart) => cart.addItem)`. It works because the bound actions are cached per cart, so the selected value never changes. That's read from the source, not the docs, so it could break in a later release. Documenting it (or exporting a hook that returns only the actions) would help.

## Opening the cart from code means calling `handleCartHover()`

- **What I expected:** an `openCart()` (or similar) for opening the cart drawer from code. Our voice agent will open the drawer when it adds an item.
- **What happened:** `handleCartClick()` toggles, `handleCloseCart()` closes, and the only action that just opens is `handleCartHover()`, whose docs describe it as a mouse-hover handler.
- **Workaround:** call `handleCartHover()` with a comment saying it opens the drawer.

## `CartProvider` has no docs page

- **What I expected:** a page listing `CartProvider`'s props.
- **What happened:** the docs sidebar shows "Components" and "Hooks" as plain headings with no pages under them. The props (`cartDetails`, `currency`, `language`, `shouldPersist`, `persistKey`, `storage`) appear only in the migration guide and in `dist/react.d.ts`.
- **Workaround:** read the type definitions.

## `validateCartItems` copies the browser's metadata into the Stripe line items

- **What I expected:** Getting Started says never to price the session from the `cartDetails` the browser sends, "because anyone can edit it", and to pass the cart to `validateCartItems`, which takes prices from your inventory. So I expected nothing from the browser except ids and quantities to reach Stripe.
- **What happened:** prices and names do come from the inventory, but `validateCartItems` (rc.2 source, `dist/utilities.mjs`) merges the browser entry's `product_data.metadata` into each line item's `price_data.product_data.metadata`. Whatever the browser posts there ends up on the Stripe product. Nothing in the docs mentions it.
- **Workaround:** before calling it, reduce the posted cart to `{ [id]: { quantity } }`. `src/checkout/checkout.ts` does this and its tests check that posted metadata doesn't reach the line items.

## `validateCartItems` wants full cart entries, and its cart type isn't exported from `/utilities`

- **What I expected:** to call `validateCartItems(inventory, { [id]: { quantity } })`, since it reads only each entry's `quantity` (plus that metadata).
- **What happened:** its second parameter is typed `CartDetails`, which requires every `CartEntry` field (`name`, `price`, `currency`, `value`, `formattedValue`, `formattedPrice`, `timestamp`). `CartDetails` isn't exported from `use-shopping-cart/utilities`, only from the React entry. It also enforces a minimum quantity of 1 but takes no maximum, so a per-line cap has to be checked separately, and when a quantity is wrong it calls `console.warn` before throwing, which adds noise to server logs.
- **Workaround:** cast with `Parameters<typeof validateCartItems>[1]`, and check quantities (1 to `MAX_LINE_QUANTITY`) before calling it, so its own checks never fire.

## No way to read the cart right after an action in React

- **What I expected:** the voice agent's tool handlers call an action (`addItem`, `setItemQuantity`) and then return the updated cart to the agent. The core `ShoppingCart` has a synchronous `getState()` for exactly this, so I expected the React hook to offer the same, or the actions to return the new state.
- **What happened:** `useShoppingCart()` returns the state from the last render plus the bound actions, and no `getState()`. The actions update the store at once, but the `cartDetails` a component holds stays as it was until React re-renders, so reading it right after an action returns the old cart. `CartProvider` builds its `ShoppingCart` internally and doesn't accept one from outside, so there's no handle to call `getState()` on either.
- **Workaround:** each handler reads the cart once, works out the cart after its change itself, calls the action, and returns a summary of the cart it worked out (`src/agent/handlers.ts`). A test runs the handlers against a real core `ShoppingCart` and checks after every call that the summary matches `getState()`. Exposing `getState` from the hook, having actions return the new state, or letting `CartProvider` take a `cart` instance would remove the need for this.
