/// <reference types="vite/client" />
import type { ReactNode } from 'react'
import { createRootRoute, HeadContent, Scripts } from '@tanstack/react-router'
import { CartProvider } from 'use-shopping-cart'
import { SHOP_NAME } from '../shop'
import appCss from '../styles.css?url'

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { title: SHOP_NAME },
    ],
    links: [{ rel: 'stylesheet', href: appCss }],
  }),
  shellComponent: RootDocument,
})

function RootDocument({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {/* One cart for every page. The server renders it empty; the saved cart
            (localStorage) is applied after hydration. A fixed currency and
            language make server and browser format prices the same way. */}
        <CartProvider currency="USD" language="en-US">
          {children}
        </CartProvider>
        <Scripts />
      </body>
    </html>
  )
}
