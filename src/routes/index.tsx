import { createFileRoute } from '@tanstack/react-router'
import { MenuPage } from '../components/MenuPage'

type HomeSearch = {
  /** Stripe sends the customer back to `/?checkout=cancelled` when they leave checkout without paying. */
  checkout?: 'cancelled'
}

export const Route = createFileRoute('/')({
  validateSearch: (search: Record<string, unknown>): HomeSearch =>
    search.checkout === 'cancelled' ? { checkout: 'cancelled' } : {},
  component: Home,
})

function Home() {
  const { checkout } = Route.useSearch()
  const navigate = Route.useNavigate()

  return (
    <MenuPage
      checkoutCancelled={checkout === 'cancelled'}
      // Dropping the search param hides the notice, and a reload won't bring it back.
      onDismissNotice={() => navigate({ to: '/', search: {}, replace: true, resetScroll: false })}
    />
  )
}
