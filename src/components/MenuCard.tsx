import { useEffect, useState } from 'react'
import { useShoppingCart } from 'use-shopping-cart'
import { formatPrice, imagePath, products, type MenuItem } from '../menu/menu'
import { largestVariant, MAX_LINE_QUANTITY } from '../shop'

/** How long the Add button says "Added ✓". */
const ADDED_FEEDBACK_MS = 1000

export function MenuCard({ item }: { item: MenuItem }) {
  const [variantId, setVariantId] = useState(() => largestVariant(item).id)
  const variant = item.variants.find((v) => v.id === variantId) ?? largestVariant(item)
  const product = products.find((p) => p.id === variant.id)

  const addItem = useShoppingCart((cart) => cart.addItem)
  const quantityInCart = useShoppingCart((cart) => cart.cartDetails[variant.id]?.quantity ?? 0)
  const atLimit = quantityInCart >= MAX_LINE_QUANTITY

  // Add clicks in a row. The button says "Added ✓" until a second passes without one.
  const [recentAdds, setRecentAdds] = useState(0)
  useEffect(() => {
    if (recentAdds === 0) return
    const timer = setTimeout(() => setRecentAdds(0), ADDED_FEEDBACK_MS)
    return () => clearTimeout(timer)
  }, [recentAdds])

  function add() {
    if (!product || atLimit) return
    addItem(product, { count: 1 })
    setRecentAdds((n) => n + 1)
  }

  return (
    <article className="menu-card">
      <img
        className="menu-card-photo"
        src={imagePath(item)}
        alt={item.name}
        width={800}
        height={600}
        loading="lazy"
      />
      <div className="menu-card-body">
        <h3 className="menu-card-name">{item.name}</h3>
        {item.tags.length > 0 && (
          <ul className="tags" aria-label="Tags">
            {item.tags.map((tag) => (
              <li key={tag} className={`tag tag-${tag}`}>
                {tag}
              </li>
            ))}
          </ul>
        )}
        <p className="menu-card-description">{item.description}</p>

        <div className="menu-card-order">
          {item.variants.length > 1 && (
            <fieldset className="size-picker">
              <legend className="visually-hidden">Size</legend>
              {item.variants.map((v) => (
                <label key={v.id} className="size-option">
                  <input
                    type="radio"
                    name={`${item.id}-size`}
                    value={v.id}
                    checked={v.id === variant.id}
                    onChange={() => setVariantId(v.id)}
                  />
                  <span>{v.label}</span>
                </label>
              ))}
            </fieldset>
          )}
          <div className="menu-card-buy">
            <span className="price">{formatPrice(variant.price)}</span>
            <button type="button" className="add-button" onClick={add} disabled={atLimit}>
              {atLimit ? `Max ${MAX_LINE_QUANTITY}` : recentAdds > 0 ? 'Added ✓' : 'Add'}
            </button>
          </div>
        </div>
        <span className="visually-hidden" role="status">
          {recentAdds > 0 && product ? `Added ${product.name} to the cart` : ''}
        </span>
      </div>
    </article>
  )
}
