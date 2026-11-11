import { useEffect, useState } from 'react'
import { useShoppingCart } from 'use-shopping-cart'
import { defaultVariant, formatPrice, imagePath, productFor, type MenuItem } from '../menu/menu'
import { useCartChanges, useMenuUi } from '../pageContext'
import { MAX_LINE_QUANTITY } from '../shop'

/** How long the Add button says "Added ✓". */
const ADDED_FEEDBACK_MS = 1000

export function MenuCard({ item }: { item: MenuItem }) {
  const [variantId, setVariantId] = useState(() => defaultVariant(item).id)
  const variant = item.variants.find((v) => v.id === variantId) ?? defaultVariant(item)
  const product = productFor(item, variant)

  const quantityInCart = useShoppingCart((cart) => cart.cartDetails[variant.id]?.quantity ?? 0)
  const atLimit = quantityInCart >= MAX_LINE_QUANTITY
  const cartChanges = useCartChanges()

  // Lit up by the find_menu_items tool, until the next search, a scroll, or a click on any card.
  const { highlighted, clearHighlight } = useMenuUi()
  const isHighlighted = highlighted.includes(item.id)

  // Add clicks in a row. The button says "Added ✓" until a second passes without one.
  const [recentAdds, setRecentAdds] = useState(0)
  useEffect(() => {
    if (recentAdds === 0) return
    const timer = setTimeout(() => setRecentAdds(0), ADDED_FEEDBACK_MS)
    return () => clearTimeout(timer)
  }, [recentAdds])

  // What screen readers hear after an add. It's written at click time, so it
  // names what was added even if the size changes afterwards, and the count
  // changes the text on every add, so each one is announced.
  const [addedMessage, setAddedMessage] = useState('')

  function add() {
    if (atLimit) return
    cartChanges.tap({ type: 'add', lines: [{ id: product.id, quantity: 1 }] })
    setRecentAdds((n) => n + 1)
    setAddedMessage(`Added ${product.name}. ${quantityInCart + 1} in your cart.`)
  }

  return (
    // A click anywhere in a card clears the highlights.
    <article className="menu-card" data-highlighted={isHighlighted || undefined} onClick={clearHighlight}>
      {/* Empty alt: the heading below already names the item, so screen readers would read it twice. */}
      <img
        className="menu-card-photo"
        src={imagePath(item)}
        alt=""
        width={800}
        height={600}
        loading="lazy"
      />
      <div className="menu-card-body">
        <h3 className="menu-card-name">{item.name}</h3>
        {isHighlighted && <span className="menu-card-match">Match</span>}
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
          {recentAdds > 0 ? addedMessage : ''}
        </span>
      </div>
    </article>
  )
}
