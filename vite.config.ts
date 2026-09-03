import path from 'node:path'
import { cloudflare } from '@cloudflare/vite-plugin'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react-swc'
import { defineConfig } from 'vite'

const appPort = Number(process.env.E2E_APP_PORT ?? 6228)
const cloudflareEnv = process.env.CLOUDFLARE_ENV

export default defineConfig(({ command }) => {
  const localDev = command === 'serve' && !cloudflareEnv
  const disableContainers = localDev || cloudflareEnv === 'e2e'

  return {
    build: {
      outDir: 'dist',
      emptyOutDir: true,
    },
    plugins: [
      react(),
      tailwindcss(),
      cloudflare({
        remoteBindings: !disableContainers,
        // Local console development and e2e do not need Sandbox containers.
        ...(disableContainers
          ? {
              config: (config) => {
                config.dev.enable_containers = false
              },
            }
          : {}),
      }),
    ],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
        '@enbor/runtime-contracts': path.resolve(__dirname, './packages/runtime-contracts/src'),
        '@server': path.resolve(__dirname, './server'),
        '@shared': path.resolve(__dirname, './shared'),
      },
    },
    server: {
      port: appPort,
      // The e2e harness assigns each run its own port; never silently drift to another one.
      strictPort: process.env.E2E_APP_PORT !== undefined,
      ...(process.env.E2E_BASE_URL ? { allowedHosts: true as const } : {}),
    },
  }
})
