import { useEffect, type RefObject } from 'react'
import { useMenuUi } from '../agent/MenuUiProvider'

// Keys that scroll the page when nothing that takes them has focus.
const SCROLL_KEYS = ['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' ']

/**
 * Brings the menu cards find_menu_items lit up into view, and clears them when
 * the customer scrolls the page themselves.
 *
 * Only the customer's own scrolling counts: the wheel, a touch drag or a scroll
 * key. A `scroll` listener would also hear the scroll started here, which can
 * run for most of a second when smooth, and clear the highlights it meant to show.
 */
export function useHighlightScroll(pageRef: RefObject<HTMLElement | null>) {
  const { highlighted, clearHighlight } = useMenuUi()

  useEffect(() => {
    const page = pageRef.current
    if (!page || highlighted.length === 0) return

    // The first match in page order, at the top, just below the sticky header.
    page.querySelector('[data-highlighted]')?.scrollIntoView({ block: 'start' })

    const onKeyDown = (event: KeyboardEvent) => {
      if (!SCROLL_KEYS.includes(event.key) || !(event.target instanceof Element)) return
      const target = event.target
      // Keys in the drawer or the suggestion card, or keys a control uses
      // (arrows pick a size, Space presses a button), don't scroll the menu.
      if (target !== document.body && !page.contains(target)) return
      if (target.closest('input, select, textarea, [contenteditable]')) return
      if (event.key === ' ' && target.closest('button, a')) return
      clearHighlight()
    }

    // Wheel and touch events over the drawer or the suggestion card don't reach the page.
    page.addEventListener('wheel', clearHighlight, { passive: true })
    page.addEventListener('touchmove', clearHighlight, { passive: true })
    document.addEventListener('keydown', onKeyDown)
    return () => {
      page.removeEventListener('wheel', clearHighlight)
      page.removeEventListener('touchmove', clearHighlight)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [pageRef, highlighted, clearHighlight])
}
