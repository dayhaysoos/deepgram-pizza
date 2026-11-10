import { useRef } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useShoppingCart } from 'use-shopping-cart'
import { MenuUiProvider } from '../agent/MenuUiProvider'
import { TapUpdatesProvider } from '../agent/TapUpdatesProvider'
import { ToolHandlersProvider } from '../agent/useToolHandlers'
import { CartDrawer } from '../components/CartDrawer'
import { MenuSection } from '../components/MenuSection'
import { SiteHeader } from '../components/SiteHeader'
import { SuggestionCard } from '../components/SuggestionCard'
import { useHighlightScroll } from '../components/useHighlightScroll'
import { categories, menu } from '../menu/menu'

type HomeSearch = {
  /** Stripe sends the customer back to `/?checkout=cancelled` when they leave checkout without paying. */
  checkout?: 'cancelled'
}

export const Route = createFileRoute('/')({
  validateSearch: (search: Record<string, unknown>): HomeSearch =>
    search.checkout === 'cancelled' ? { checkout: 'cancelled' } : {},
  component: Home,
})

function Home() {
  // What the voice tools change on screen, the tool handlers that change it,
  // and the updates the agent gets when the customer taps.
  return (
    <MenuUiProvider>
      <ToolHandlersProvider>
        <TapUpdatesProvider>
          <MenuPage />
        </TapUpdatesProvider>
      </ToolHandlersProvider>
    </MenuUiProvider>
  )
}

function MenuPage() {
  const cartOpen = useShoppingCart((cart) => cart.shouldDisplayCart)
  const cartButtonRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLElement>(null)
  const pageRef = useRef<HTMLDivElement>(null)
  useHighlightScroll(pageRef)
  const { checkout } = Route.useSearch()
  const navigate = Route.useNavigate()

  function dismissNotice() {
    // Dropping the search param hides the notice, and a reload won't bring it back.
    navigate({ to: '/', search: {}, replace: true, resetScroll: false })
    // The Dismiss button goes with the notice. Move focus to the menu so it
    // isn't dropped on the page body.
    menuRef.current?.focus({ preventScroll: true })
  }

  return (
    <>
      {/* While the cart is open, the page behind it can't be focused or clicked. */}
      <div className="page" ref={pageRef} inert={cartOpen}>
        <SiteHeader cartButtonRef={cartButtonRef} />
        <main className="menu" ref={menuRef} tabIndex={-1}>
          {checkout === 'cancelled' && (
            <div className="notice" role="status">
              <p>Checkout cancelled. Your cart is just as you left it.</p>
              <button
                type="button"
                className="icon-button"
                aria-label="Dismiss"
                onClick={dismissNotice}
              >
                ✕
              </button>
            </div>
          )}
          {categories.map((category) => (
            <MenuSection
              key={category.id}
              category={category}
              items={menu.filter((item) => item.category === category.id)}
            />
          ))}
        </main>
      </div>
      {/* Outside the page, so it stays usable beside an open cart (styles.css says where it sits). */}
      <SuggestionCard returnFocusRef={cartButtonRef} />
      <CartDrawer returnFocusRef={cartButtonRef} />
    </>
  )
}
