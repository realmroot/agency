// Public entry point for @realmroot/enbor-sdk.
//
// Prefer the stable facades: `createAmaClient(...).<resource>.<verb>(...)`
// for public control-plane calls and `createAmaRunnerClient(...)` for runner
// protocol calls.
// It is generated from sdk/spec/resources.json and insulates consumers from the
// raw OpenAPI operation layer.
//
// Everything under ./generated is produced by `pnpm run generate`
// (@hey-api/openapi-ts) from sdk/openapi.json — do not edit it by hand. The raw
// typed operation functions and models are also re-exported below as an escape
// hatch for operations the facade does not wrap yet.
export { createAmaClient, createAmaRunnerClient, AmaApiError } from './client.js';
export * from './generated/index.js';
export { createClient, createConfig, mergeHeaders } from './generated/client/index.js';
