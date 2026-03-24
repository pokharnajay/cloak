/**
 * CLI environment helpers.
 *
 * Delegates to platform.ts for cross-platform PATH discovery.
 * This file exists for backward compatibility — callers that already
 * import from './cli-env' continue to work unchanged.
 */

export { getCliPath, getCliEnv } from './platform'
