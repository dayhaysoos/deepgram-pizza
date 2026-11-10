import { useRef } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useShoppingCart } from 'use-shopping-cart'
import { CartDrawer } from '../components/CartDrawer'
import { MenuSection } from '../components/MenuSection'
import { SiteHeader } from '../components/SiteHeader'
import { categories, menu } from '../menu/menu'

export const Route = createFileRoute('/')({
  component: Home,
})

function Home() {
  const cartOpen = useShoppingCart((cart) => cart.shouldDisplayCart)
  const cartButtonRef = useRef<HTMLButtonElement>(null)

  return (
    <>
      {/* While the cart is open, the page behind it can't be focused or clicked. */}
      <div className="page" inert={cartOpen}>
        <SiteHeader cartButtonRef={cartButtonRef} />
        <main className="menu">
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
