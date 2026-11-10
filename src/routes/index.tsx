import { useRef } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useShoppingCart } from 'use-shopping-cart'
import { CartDrawer } from '../components/CartDrawer'
import { MenuSection } from '../components/MenuSection'
import { SiteHeader } from '../components/SiteHeader'
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
  const cartOpen = useShoppingCart((cart) => cart.shouldDisplayCart)
  const cartButtonRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLElement>(null)
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
      <div className="page" inert={cartOpen}>
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
      <CartDrawer returnFocusRef={cartButtonRef} />
    </>
  )
}
