import type { Ref } from 'react'
import { useShoppingCart } from 'use-shopping-cart'
import { categories } from '../menu/menu'
import { SHOP_NAME } from '../shop'

type SiteHeaderProps = {
  /** The cart drawer sends focus back here when it closes. */
  cartButtonRef: Ref<HTMLButtonElement>
}

export function SiteHeader({ cartButtonRef }: SiteHeaderProps) {
  const cartCount = useShoppingCart((cart) => cart.cartCount)
  const toggleCart = useShoppingCart((cart) => cart.handleCartClick)

  return (
    <header className="site-header">
      <div className="site-header-row">
        <h1 className="brand">{SHOP_NAME}</h1>
        <button
          ref={cartButtonRef}
          type="button"
          className="cart-button"
          aria-haspopup="dialog"
          aria-label={`Cart, ${cartCount} ${cartCount === 1 ? 'item' : 'items'}`}
          onClick={toggleCart}
        >
          Cart
          {cartCount > 0 && <span className="cart-badge">{cartCount}</span>}
        </button>
      </div>
      <nav aria-label="Menu categories">
        <ul className="category-links">
          {categories.map((category) => (
            <li key={category.id}>
              <a href={`#${category.id}`}>{category.label}</a>
            </li>
          ))}
        </ul>
      </nav>
    </header>
  )
}
