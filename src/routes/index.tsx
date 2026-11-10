import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/')({
  component: Home,
})

function Home() {
  return (
    <main>
      <h1>Nick's Pizza</h1>
      <p>The menu is coming soon.</p>
    </main>
  )
}
