/**
 * Architecture enforcement for the hono-cf-clean-arch layout.
 *   pnpm lint:arch  →  depcruise server/ shared/ --config .dependency-cruiser.cjs
 *
 * The clean core is domain/ → usecases/ → adapters/ ← http/. Those rules are
 * strict. After the clean-arch endgame the drizzle rule has exactly two named
 * exceptions:
 *   - server/auth        OIDC/session auth module: owns its tables, is the auth
 *                        wall, spans layers by design (the skill's accepted
 *                        auth-module exception).
 *   - server/http/e2e.ts e2e test fixture (gated by ENBOR_E2E_TEST_AUTH): reads
 *                        raw persisted vault rows incl. ciphertext for
 *                        encryption-at-rest scenarios — storage-level inspection
 *                        is its whole purpose, so it holds drizzle rather than
 *                        polluting the VaultRepo port with a test-only method.
 *
 * Everything else is drizzle-free: composition.ts wires the db via db/client,
 * audit.ts delegates to adapters/repos/audit-write, and app.ts is a pure
 * assembler. The runtime is folded into domain/usecases/adapters/http under the
 * standard clean-arch rules; the only named cross-layer modules are the Durable
 * Objects under server/worker/ and runtime-core/.
 */

const INFRA = '^server/auth|^server/http/e2e\\.ts'

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'no-circular',
      severity: 'error',
      from: {},
      to: { circular: true },
    },
    {
      name: 'domain-stays-pure',
      comment: 'domain/ may only import domain/ and shared/. No frameworks, no I/O.',
      severity: 'error',
      from: { path: '^server/domain' },
      to: { pathNot: '^server/domain|^shared' },
    },
    {
      name: 'usecases-no-infrastructure',
      comment: 'usecases/ must not reach outward to adapters, http, db, or composition.',
      severity: 'error',
      from: { path: '^server/usecases' },
      to: { path: '^server/(adapters|http|db)|^server/composition' },
    },
    {
      name: 'usecases-no-framework-packages',
      comment: 'usecases/ must not import delivery or persistence frameworks.',
      severity: 'error',
      from: { path: '^server/usecases' },
      to: { path: 'node_modules/(hono|drizzle-orm)|@hono/' },
    },
    {
      name: 'adapters-not-into-delivery',
      comment: 'adapters/ implement ports; they never know about http/ or composition.',
      severity: 'error',
      from: { path: '^server/adapters' },
      to: { path: '^server/(http|composition)' },
    },
    {
      name: 'drizzle-stays-in-persistence',
      comment: 'Persistence is confined to adapters/ (repos + gateways that hold a db handle), db/, and the named env-bound infrastructure modules.',
      severity: 'error',
      from: { path: '^server', pathNot: `^server/(adapters|db)|${INFRA}` },
      to: { path: 'node_modules/drizzle-orm|^server/db/schema' },
    },
    {
      name: 'http-not-into-adapters',
      comment: 'http/ gets dependencies from context, never constructs adapters.',
      severity: 'error',
      from: { path: '^server/http' },
      to: { path: '^server/adapters' },
    },
    {
      name: 'shared-is-a-leaf',
      comment: 'shared/ is the contract; it imports nothing from server/ or src/.',
      severity: 'error',
      from: { path: '^shared' },
      to: { path: '^server|^src' },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    exclude: { path: ['\\.(test|spec)\\.[jt]sx?$', '\\.gen\\.[jt]s$', 'server/worker-configuration'] },
    tsConfig: { fileName: 'server/tsconfig.json' },
    tsPreCompilationDeps: true,
  },
}
