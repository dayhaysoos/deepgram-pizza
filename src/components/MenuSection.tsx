import type { Category, MenuItem } from '../menu/menu'
import { MenuCard } from './MenuCard'

type MenuSectionProps = {
  category: { id: Category; label: string; note?: string }
  items: MenuItem[]
}

export function MenuSection({ category, items }: MenuSectionProps) {
  const headingId = `${category.id}-heading`

  return (
    // The id is what the header's category links point at.
    <section id={category.id} className="menu-section" aria-labelledby={headingId}>
      <div className="menu-section-heading">
        <h2 id={headingId}>{category.label}</h2>
        {category.note && <p className="menu-section-note">{category.note}</p>}
      </div>
      <ul className="menu-grid">
        {items.map((item) => (
          <li key={item.id}>
            <MenuCard item={item} />
          </li>
        ))}
      </ul>
    </section>
  )
}
