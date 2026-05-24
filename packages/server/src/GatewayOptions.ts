import type { GatewayAuthConfig } from "./GatewayAuthConfig.js";
import type { GatewayControlPlaneAuditConfig } from "./GatewayControlPlaneAuditConfig.js";
import type { GatewayDefaults } from "./GatewayDefaults.js";
import type { GatewayOperatorUiConfig } from "./GatewayOperatorUiConfig.js";
import type { GatewayProductionPolicy } from "./GatewayProductionPolicy.js";
import type { GatewayUiConfig } from "./GatewayUiConfig.js";

export type GatewayOptions = {
  protocol?: number;
  features?: string[];
  heartbeatMs?: number;
  auth?: GatewayAuthConfig;
  ui?: GatewayUiConfig;
  /**
   * Built-in browser console for operators. Set to false to disable it.
   * @default { path: "/console" }
   */
  operatorUi?: GatewayOperatorUiConfig | false;
  defaults?: GatewayDefaults;
  /**
   * Optional audit sink for multi-tenant deployments using ControlPlaneStore.
   * Gateway records normalized auth and mutation events without token values.
   */
  controlPlane?: GatewayControlPlaneAuditConfig;
  maxBodyBytes?: number;
  maxPayload?: number;
  maxConnections?: number;
  /**
   * Enables opt-in production readiness enforcement for Gateway auth, scope,
   * token, proxy, and bound settings.
   */
  production?: boolean | GatewayProductionPolicy;
  /**
   * Per-run replay window for Gateway run event streams.
   * @default 10000
   */
  eventWindowSize?: number;
  /**
   * Maximum time (in milliseconds) allowed for the HTTP parser to receive the
   * complete headers of a single request. Helps mitigate slowloris attacks.
   * @default 30000
   */
  headersTimeout?: number;
  /**
   * Maximum time (in milliseconds) allowed for a single request to be received
   * and parsed, including the body. Helps mitigate slowloris attacks.
   * @default 60000
   */
  requestTimeout?: number;
};
