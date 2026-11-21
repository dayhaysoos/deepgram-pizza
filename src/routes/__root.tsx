/// <reference types="vite/client" />
import type { ReactNode } from 'react'
import { createRootRoute, HeadContent, Scripts } from '@tanstack/react-router'
import { CartProvider } from 'use-shopping-cart'
import { CURRENCY, LOCALE, SHOP_NAME } from '../shop'
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
  // Sent with every page the server renders. Only this site may show the shop
  // in a frame, so another site can't lay its own page over the buttons; and
  // the browser takes the page as the type the server says it is.
  headers: () => ({
    'Content-Security-Policy': "frame-ancestors 'self'",
    'X-Content-Type-Options': 'nosniff',
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
            (localStorage) is applied after hydration. The fixed currency and
            locale from shop.ts make server and browser format prices the same way. */}
        <CartProvider currency={CURRENCY} language={LOCALE}>
          {children}
        </CartProvider>
        <Scripts />
      </body>
    </html>
  )
}
