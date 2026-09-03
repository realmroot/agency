// Type-safety linting, focused. Biome owns formatting and base lint; this config
// adds ONLY the type-aware rules Biome cannot run (it does not connect to the
// type checker). Scope: server/ + shared/ production code — the API contract
// surface. The goal is to forbid the escape hatches that strict tsconfig allows:
// `any`, any-typed value flow, and type assertions that bypass the checker.

import tseslint from 'typescript-eslint'

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/.wrangler/**',
      'sdk/**',
      'cmd/**',
      'packages/runtime-bridge/**',
      'migrations/**',
      'src/**',
      'e2e/**',
      'scripts/**',
      '**/*.config.*',
      'vitest*.ts',
      // Tests legitimately cast mocks; the contract surface is the target.
      '**/*.test.ts',
      // Excluded from tsconfig.server.json, so typed linting cannot resolve them.
      'server/integration/**',
      // E2E_TEST_AUTH-gated test endpoint; design §1.8 exempts /api/e2e/* from
      // the v1 contract, and it builds partial test fixtures like real test files.
      'server/http/e2e.ts',
    ],
  },
  {
    files: ['server/**/*.ts', 'shared/**/*.ts'],
    plugins: { '@typescript-eslint': tseslint.plugin },
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      // 1. No `any` — explicit or implicit re-introduction.
      '@typescript-eslint/no-explicit-any': 'error',
      // 2. No `any`-typed value flowing through the code (the contagion Biome misses).
      '@typescript-eslint/no-unsafe-assignment': 'error',
      '@typescript-eslint/no-unsafe-member-access': 'error',
      '@typescript-eslint/no-unsafe-call': 'error',
      '@typescript-eslint/no-unsafe-return': 'error',
      '@typescript-eslint/no-unsafe-argument': 'error',
      // 3. Prefer `satisfies` over object-literal `as` casts (the cast bypasses
      //    excess-property checks). A warning, not a block: at genuine trust
      //    boundaries and in partial test fixtures an assertion is the honest
      //    tool, and `satisfies` cannot express loose-record normalization.
      '@typescript-eslint/consistent-type-assertions': [
        'warn',
        { assertionStyle: 'as', objectLiteralTypeAssertions: 'never' },
      ],
      // 4. Ban ONLY the `x as unknown as T` double cast — it launders a value
      //    through `unknown` to a type it does not overlap. The single
      //    `JSON.parse(x) as unknown` narrowing pattern is safe and stays allowed:
      //    the inner-as-unknown is matched only when it is the operand of an
      //    outer assertion.
      'no-restricted-syntax': [
        'error',
        {
          selector: 'TSAsExpression > TSAsExpression[typeAnnotation.type="TSUnknownKeyword"]',
          message: 'No `as unknown as` double cast — validate at the boundary (zod) instead of telling the compiler to trust you.',
        },
      ],
    },
  },
)
