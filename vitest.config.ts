import path from 'node:path'
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-pool-workers'
import react from '@vitejs/plugin-react-swc'
import { defineConfig } from 'vitest/config'

process.env.CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV = 'false'

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@ama/runtime-contracts': path.resolve(__dirname, './packages/runtime-contracts/src'),
      '@server': path.resolve(__dirname, './server'),
      '@shared': path.resolve(__dirname, './shared'),
    },
  },
  test: {
    // Coverage gates the layers the fast suites (unit + web) own; the workerd
    // integration pool can't be v8-instrumented, so http full-flow / repos /
    // composition / worker / auth-jwks / runtime execution are proven by the
    // integration + e2e suites and lint:arch, not a %. Business logic (domain +
    // usecases) must be provable here without the stack — gated at 95%.
    coverage: {
      provider: 'v8',
      include: [
        'server/domain/**',
        'server/usecases/**',
        'server/adapters/gateways/**',
        'src/features/**',
        'src/lib/**',
        'packages/runtime-contracts/src/bridge-protocol.ts',
        'server/contracts/runner-protocol.ts',
      ],
      // shared/ and runtime-contract session transport files are intentionally NOT
      // %-gated here: they are imported by BOTH the node unit suite and the jsdom
      // web suite, and v8 instruments them with different function maps per
      // environment, so the multi-project merge undercounts functions even when
      // their dedicated unit suites cover every exported parser/schema branch.
      // They are guarded by shared/session-events.test.ts and
      // packages/runtime-contracts/src/*.test.ts in the unit suite.
      exclude: [
        '**/*.test.ts',
        '**/*.test.tsx',
        '**/*.d.ts',
        '**/index.ts',
        'src/lib/utils.ts',
        'src/lib/query-keys.ts',
        // Relocated runtime DATA-PLANE. The clean-arch fold moved this code out of
        // server/runtime/ (which was NEVER in the coverage include) into these
        // layer dirs, but its correctness posture is unchanged: the turn loop,
        // sandbox host, queue/runner bindings, and the runtime rules are proven by
        // the server/integration suite, the session-orchestration golden master,
        // and lint:arch layer enforcement — not by v8 %. Keeping them gated here
        // would re-coverage-gate code that was deliberately exempt pre-fold; these
        // entries restore that posture without weakening coverage on the genuine
        // REST business logic in server/domain + server/usecases.
        'server/domain/runtime/**',
        'server/usecases/runtime/**',
        'server/adapters/gateways/cloud-turn-queue.ts',
        'server/adapters/gateways/runner-channel.ts',
        'server/adapters/gateways/session-do-events.ts',
        'server/adapters/gateways/runtime-secret-env.ts',
        'server/adapters/gateways/mcp-client.ts',
      ],
      thresholds: {
        perFile: true,
        statements: 90,
        branches: 80,
        functions: 90,
        lines: 90,
        'server/domain/**': { statements: 95, branches: 94.9, functions: 95, lines: 95 },
        'server/usecases/**': { statements: 95, branches: 95, functions: 95, lines: 95 },
        'packages/runtime-contracts/src/bridge-protocol.ts': {
          statements: 100,
          branches: 100,
          functions: 100,
          lines: 100,
        },
        'server/contracts/runner-protocol.ts': { statements: 100, branches: 100, functions: 100, lines: 100 },
      },
      reporter: ['text', 'text-summary'],
    },
    projects: [
      {
        // unit (node): server business layers + shared + runtime bridge. The
        // cheapest suite — pure logic and fake-port use cases, no jsdom, no D1.
        extends: true,
        test: {
          name: 'unit',
          environment: 'node',
          include: [
            'server/domain/**/*.test.ts',
            'server/usecases/**/*.test.ts',
            'server/adapters/**/*.test.ts',
            'server/auth/**/*.test.ts',
            'server/worker/**/*.test.ts',
            'server/*.test.ts',
            'shared/**/*.test.ts',
            'packages/runtime-bridge/src/**/*.test.ts',
            'packages/runtime-contracts/src/**/*.test.ts',
            'server/contracts/**/*.test.ts',
          ],
        },
      },
      {
        // web (jsdom): the React SPA — client logic, hooks, components driven
        // through the REAL api client with MSW at the network boundary.
        extends: true,
        plugins: [react()],
        test: {
          name: 'web',
          environment: 'jsdom',
          globals: true,
          include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
          setupFiles: ['./src/test/setup.ts'],
        },
      },
      {
        // integration (workerd + real D1): the assembled server through app.fetch.
        extends: true,
        plugins: [
          cloudflareTest(async () => {
            const migrationsPath = path.join(__dirname, './migrations')
            const migrations = await readD1Migrations(migrationsPath)

            return {
              wrangler: { configPath: './wrangler.test.toml' },
              miniflare: {
                bindings: { TEST_MIGRATIONS: migrations },
              },
            }
          }),
        ],
        test: {
          name: 'integration',
          include: ['server/integration/**/*.test.ts'],
          setupFiles: ['./server/integration/apply-migrations.ts'],
        },
      },
    ],
  },
})
