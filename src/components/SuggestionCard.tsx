import { useId, useState, type RefObject } from 'react'
import { useShoppingCart } from 'use-shopping-cart'
import { describeLine, quantitiesOf } from '../agent/cartSummary'
import { addLines, type Suggestions } from '../agent/handlers'
import { useMenuUi } from '../agent/MenuUiProvider'
import { useReportTap } from '../agent/TapUpdatesProvider'

type SuggestionCardProps = {
  /**
   * Gets focus when the customer closes the card or adds everything on it: the
   * header's cart button, or a control in the cart while it's open, since the
   * page behind an open cart is inert and can't take focus.
   */
  returnFocusRef: RefObject<HTMLElement | null>
}

// The card the show_suggestions tool opens: pairings, recommendations or a
// plan for a group. It's a sheet above the talk button, not a modal: the menu
// stays usable behind it, and the conversation goes on. A new set of
// suggestions replaces it.
export function SuggestionCard({ returnFocusRef }: SuggestionCardProps) {
  const { shown, closeSuggestions } = useMenuUi()

  function close() {
    closeSuggestions()
    returnFocusRef.current?.focus()
  }

  return (
    <>
      {/* Always rendered: screen readers announce a change to a live region, not a new one. */}
      <p className="visually-hidden" role="status">
        {shown ? `Suggestions: ${shown.suggestions.title}` : ''}
      </p>
      {shown && <SuggestionSheet key={shown.key} suggestions={shown.suggestions} onClose={close} />}
    </>
  )
}

/** One line on the card: an item, how many, and what they cost. */
type SuggestedLine = Suggestions['lines'][number]

function SuggestionSheet({ suggestions, onClose }: { suggestions: Suggestions; onClose: () => void }) {
  const cartDetails = useShoppingCart((cart) => cart.cartDetails)
  const addItem = useShoppingCart((cart) => cart.addItem)
  const reportTap = useReportTap()
  const [notice, setNotice] = useState<{ text: string; refused: boolean } | null>(null)
  const titleId = useId()

  // Add and Add all check lines exactly as the add_items tool does: all or nothing,
  // at most MAX_LINE_QUANTITY per line counting the cart. Returns whether the
  // lines went in.
  function add(lines: SuggestedLine[]): boolean {
    const result = addLines({ addItem }, quantitiesOf(cartDetails), lines)
    if ('message' in result) {
      setNotice({ text: result.message, refused: true })
      return false
    }
    reportTap({ type: 'add', lines: result.lines })
    setNotice({ text: `Added ${lines.map(describeLine).join(', ')}.`, refused: false })
    return true
  }

  // The card has done its job once everything on it is in the cart.
  function addAll() {
    if (add(suggestions.lines)) onClose()
  }

  return (
    <section className="suggestion-card" aria-labelledby={titleId}>
      <div className="suggestion-header">
        <h2 id={titleId}>{suggestions.title}</h2>
        <button type="button" className="icon-button" aria-label="Close suggestions" onClick={onClose}>
          ✕
        </button>
      </div>
      {suggestions.reason && <p className="suggestion-reason">{suggestions.reason}</p>}

      <ul className="suggestion-lines">
        {suggestions.lines.map((line) => (
          <li key={line.id} className="suggestion-line">
            <span className="suggestion-line-name">{describeLine(line)}</span>
            <span className="suggestion-line-total">{line.total}</span>
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
          <span>Total</span> <span>{suggestions.total}</span>
        </p>
        <button type="button" className="add-button" onClick={addAll}>
          Add all
        </button>
      </div>
    </section>
  )
}
