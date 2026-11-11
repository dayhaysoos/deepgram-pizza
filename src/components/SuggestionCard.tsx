import { useId, useState, type RefObject } from 'react'
import { describeLine, summarizeLines } from '../agent/cartSummary'
import { checkLinesToAdd, type Suggestions } from '../agent/handlers'
import { useCartChanges, useMenuUi, useOrderType } from '../pageContext'

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
// suggestions replaces it. It reads as a suggestion, not as the cart: the
// owner took the plan's card for a cart the agent had filled (2026-11-11), so
// it's labelled "Our suggestion", says what it "comes to" rather than a
// total, and its button says where Add all goes. With a voice session on, it
// comes up once the agent has started talking (MenuUiProvider.tsx).
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
  const cartChanges = useCartChanges()
  const [notice, setNotice] = useState<{ text: string; refused: boolean } | null>(null)
  const titleId = useId()
  // For a group plan and delivery, what it comes to with the fee, as the agent says a plan's total.
  const orderType = useOrderType()
  const delivery = suggestions.group ? summarizeLines(suggestions.lines, orderType).delivery : undefined

  // Add and Add all check lines exactly as the add_items tool does: all or nothing,
  // at most MAX_LINE_QUANTITY per line counting the cart. Returns whether the
  // lines went in.
  function add(lines: SuggestedLine[]): boolean {
    const checked = checkLinesToAdd(lines, cartChanges.now())
    if ('message' in checked) {
      setNotice({ text: checked.message, refused: true })
      return false
    }
    cartChanges.tap({ type: 'add', lines: checked.lines })
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
        <div>
          <p className="suggestion-kicker">Our suggestion</p>
          <h2 id={titleId}>{suggestions.title}</h2>
        </div>
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
        <div>
          <p className="suggestion-total">
            <span>Comes to</span> <span>{suggestions.total}</span>
          </p>
          {delivery && <p className="suggestion-delivery">{delivery.totalWithDelivery} with delivery</p>}
        </div>
        <button type="button" className="add-button" onClick={addAll}>
          Add all to cart
        </button>
      </div>
    </section>
  )
}
