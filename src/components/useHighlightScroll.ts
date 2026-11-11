import { useEffect, type RefObject } from 'react'
import { useMenuUi } from '../pageContext'

/** How long the page goes without a scroll event before the highlight's own scroll counts as done. */
const SCROLL_SETTLE_MS = 150

/**
 * Brings the menu cards find_menu_items lit up into view, and clears them as
 * soon as the page scrolls any other way: the wheel, a touch drag, a scroll
 * key, the scrollbar, or a category link in the header.
 *
 * The trap: a `scroll` listener also hears the scroll started here, which can
 * run for most of a second when smooth, and would clear the highlights it
 * meant to show. So scroll events are ignored from the moment that scroll
 * starts until it settles: at `scrollend` where the browser has it, or once
 * scroll events stop for a moment (which also covers there being nothing to
 * scroll). Only the page's own scrolling counts; scrolling inside the drawer
 * or the suggestion card doesn't reach `window`.
 */
export function useHighlightScroll(pageRef: RefObject<HTMLElement | null>) {
  const { highlighted, clearHighlight } = useMenuUi()

  useEffect(() => {
    const page = pageRef.current
    if (!page || highlighted.length === 0) return

    let ownScroll = true
    const settle = () => {
      ownScroll = false
    }
    let settleTimer = setTimeout(settle, SCROLL_SETTLE_MS)
    const onScroll = () => {
      if (!ownScroll) return clearHighlight()
      clearTimeout(settleTimer)
      settleTimer = setTimeout(settle, SCROLL_SETTLE_MS)
    }

    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('scrollend', settle)
    // The first match in page order, at the top, just below the sticky header.
    page.querySelector('[data-highlighted]')?.scrollIntoView({ block: 'start' })

    return () => {
      clearTimeout(settleTimer)
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('scrollend', settle)
    }
  }, [pageRef, highlighted, clearHighlight])
}
