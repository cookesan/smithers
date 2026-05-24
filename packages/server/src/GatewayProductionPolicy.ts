export type GatewayProductionPolicy = {
  /**
   * Enable production readiness enforcement. Passing `production: true` to
   * GatewayOptions enables the default policy.
   */
  enabled?: boolean;
  /**
   * Allow a Gateway with no auth config. This should be reserved for private
   * development networks.
   */
  allowAnonymous?: boolean;
  /** Allow grants or defaults that include the wildcard `*` scope. */
  allowWildcardScopes?: boolean;
  /** Allow legacy broad scopes such as `admin` and `execute`. */
  allowLegacyScopes?: boolean;
  /** Require static token grants to have an expiry timestamp. */
  requireTokenExpiry?: boolean;
  /** Require static token grants to carry stable user and token identifiers. */
  requireTokenIdentity?: boolean;
  /** Require trusted-proxy mode to pin allowed browser origins. */
  requireTrustedProxyOrigins?: boolean;
  /** Minimum HMAC secret size for JWT auth, measured in UTF-8 bytes. */
  minJwtSecretBytes?: number;
  /** Maximum accepted static token lifetime in milliseconds. */
  maxTokenTtlMs?: number;
  /** Maximum accepted HTTP request body size in bytes. */
  maxBodyBytes?: number;
  /** Maximum accepted WebSocket RPC payload size in bytes. */
  maxPayloadBytes?: number;
  /** Maximum accepted concurrent WebSocket connections. */
  maxConnections?: number;
};
