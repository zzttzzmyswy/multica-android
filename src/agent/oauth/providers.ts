/**
 * @deprecated This file is deprecated. Import from '../providers/index.js' instead.
 *
 * This file re-exports from the new providers/ module for backwards compatibility.
 * Will be removed in a future version.
 */

export {
  type AuthMethod,
  type ProviderInfo,
  type ProviderConfig,
  isOAuthProvider,
  isProviderAvailable,
  getCurrentProvider,
  getProviderList,
  getAvailableProviders,
  formatProviderStatus,
  getLoginInstructions,
  resolveProviderConfig,
} from "../providers/index.js";
