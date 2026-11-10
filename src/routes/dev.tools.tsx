// /dev/tools: the menu page plus a panel that runs the voice agent's tools by
// hand, through the same handlers the agent uses, so the page can be built and
// tested without a microphone.
//
// It's dev only. It changes the cart and starts checkout with no voice session
// and nothing to ask the customer, which is a developer's tool, not a page for
// customers. So in a production build the route answers 404, and the panel's
// code isn't in the bundle at all.

import { lazy, Suspense, useCallback, useState } from 'react'
import { createFileRoute, notFound } from '@tanstack/react-router'
import { TapUpdateSinkContext, type TapUpdateSink } from '../agent/TapUpdatesProvider'
import { MenuPage } from '../components/MenuPage'
import type { LoggedUpdate } from '../dev/ToolsPanel'

// `import.meta.env.DEV` is `false` in a production build, so Vite drops this
// branch and the panel's module, with its styles, never reaches the bundle.
const ToolsPanel = import.meta.env.DEV ? lazy(() => import('../dev/ToolsPanel')) : null

export const Route = createFileRoute('/dev/tools')({
  beforeLoad: () => {
    if (!import.meta.env.DEV) throw notFound()
  },
  component: DevTools,
})

function DevTools() {
  // The updates a tap would send the agent, newest first. A voice session
  // will provide a sink that sends them; this one keeps them for the panel.
  const [updates, setUpdates] = useState<LoggedUpdate[]>([])
  const logUpdate = useCallback<TapUpdateSink>((text) => {
    setUpdates((logged) => [{ id: (logged[0]?.id ?? 0) + 1, time: new Date(), text }, ...logged])
  }, [])

  return (
    <TapUpdateSinkContext value={logUpdate}>
      <MenuPage>
        {ToolsPanel && (
          <Suspense fallback={null}>
            <ToolsPanel updates={updates} />
          </Suspense>
        )}
      </MenuPage>
    </TapUpdateSinkContext>
  )
}
