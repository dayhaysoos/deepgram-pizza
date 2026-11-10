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
