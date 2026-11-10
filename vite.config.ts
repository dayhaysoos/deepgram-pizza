import { cloudflare } from '@cloudflare/vite-plugin'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import viteReact from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  server: { port: 3000 },
  plugins: [
    // Runs the server bundle in workerd, the Cloudflare Workers runtime.
    cloudflare({ viteEnvironment: { name: 'ssr' } }),
    tanstackStart(),
    // React's plugin must come after TanStack Start's.
    viteReact(),
  ],
})
