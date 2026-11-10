import { useId, useState, type RefObject } from 'react'
import { useShoppingCart } from 'use-shopping-cart'
import { addLines, type SuggestionCard as Card } from '../agent/handlers'
import { useMenuUi } from '../agent/MenuUiProvider'
import { useReportTap } from '../agent/TapUpdatesProvider'

type SuggestionCardProps = {
  /** Gets focus when the customer closes the card or adds everything on it (the header's cart button). */
  returnFocusRef: RefObject<HTMLElement | null>
}

// The card the show_suggestions tool opens: pairings, recommendations or a
// plan for a group. It's a sheet above the talk button, not a modal: the menu
// stays usable behind it, and the conversation goes on. A new set of
// suggestions replaces it.
export function SuggestionCard({ returnFocusRef }: SuggestionCardProps) {
  const { suggestion, closeSuggestions } = useMenuUi()

  function close() {
    closeSuggestions()
    returnFocusRef.current?.focus()
  }

  return (
    <>
      {/* Always rendered: screen readers announce a change to a live region, not a new one. */}
      <p className="visually-hidden" role="status">
        {suggestion ? `Suggestions: ${suggestion.card.title}` : ''}
      </p>
      {suggestion && <SuggestionSheet key={suggestion.key} card={suggestion.card} onClose={close} />}
    </>
  )
}

type Line = Card['lines'][number]

function SuggestionSheet({ card, onClose }: { card: Card; onClose: () => void }) {
  const cartDetails = useShoppingCart((cart) => cart.cartDetails)
  const addItem = useShoppingCart((cart) => cart.addItem)
  const reportTap = useReportTap()
  const [notice, setNotice] = useState<{ text: string; refused: boolean } | null>(null)
  const titleId = useId()

  // Add and Add all check lines exactly as the add_items tool does: all or nothing,
  // at most 20 per line counting the cart. Returns whether the lines went in.
  function add(lines: Line[]): boolean {
    const added = lines.map(({ id, quantity }) => ({ id, quantity }))
    const result = addLines({ cartDetails: () => cartDetails, addItem }, added)
    if ('message' in result) {
      setNotice({ text: result.message, refused: true })
      return false
    }
    reportTap({ type: 'add', lines: added })
    setNotice({ text: `Added ${lines.map((line) => `${line.quantity} × ${line.name}`).join(', ')}.`, refused: false })
    return true
  }

  // The card has done its job once everything on it is in the cart.
  function addAll() {
    if (add(card.lines)) onClose()
  }

  return (
    <section className="suggestion-card" aria-labelledby={titleId}>
      <div className="suggestion-header">
        <h2 id={titleId}>{card.title}</h2>
        <button type="button" className="icon-button" aria-label="Close suggestions" onClick={onClose}>
          ✕
        </button>
      </div>
      {card.reason && <p className="suggestion-reason">{card.reason}</p>}

      <ul className="suggestion-lines">
        {card.lines.map((line) => (
          <li key={line.id} className="suggestion-line">
            <span className="suggestion-line-name">
              {line.quantity} × {line.name}
            </span>
            <span className="suggestion-line-total">{line.lineTotal}</span>
            <button
              type="button"
              className="suggestion-add"
              aria-label={`Add ${line.quantity} ${line.name}`}
              onClick={() => add([line])}
            >
              Add
            </button>
          </li>
        ))}
      </ul>

      <p className="suggestion-notice" role="status" data-refused={notice?.refused || undefined}>
        {notice?.text}
      </p>
      <div className="suggestion-footer">
        <p className="suggestion-total">
          <span>Total</span> <span>{card.total}</span>
        </p>
        <button type="button" className="add-button" onClick={addAll}>
          Add all
        </button>
      </div>
    </section>
  )
}
