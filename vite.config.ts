import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import { AI_PROXIES, createApiMiddleware, resolveRedmineBin } from './server/api'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    {
      name: 'configure-server',
      configureServer(server) {
        server.middlewares.use(
          createApiMiddleware({
            redmineBin: resolveRedmineBin(),
            dataDir: process.cwd(),
            gnomeExtensionDir: path.join(process.cwd(), 'gnome-extension'),
            // Chạy dev trên máy cá nhân thì bật; Docker/k8s đặt ENABLE_AGENT_HISTORY=0 để tắt
            enableLocalActivity: process.env.ENABLE_AGENT_HISTORY !== '0',
          })
        )
      }
    }
  ],
  server: {
    allowedHosts: ['logtime.estuary'],
    proxy: Object.fromEntries(
      Object.entries(AI_PROXIES).map(([prefix, target]) => [
        prefix,
        { target, changeOrigin: true, rewrite: (p: string) => p.replace(new RegExp(`^${prefix}`), '') },
      ])
    ),
  }
})
