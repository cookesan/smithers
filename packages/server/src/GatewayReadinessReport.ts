export type GatewayReadinessSeverity = "info" | "warning" | "error";

export type GatewayReadinessStatus = "pass" | "warn" | "fail";

export type GatewayReadinessCheck = {
  id: string;
  severity: GatewayReadinessSeverity;
  message: string;
  details?: Record<string, unknown>;
};

export type GatewayReadinessReport = {
  status: GatewayReadinessStatus;
  production: boolean;
  checkedAtMs: number;
  checks: GatewayReadinessCheck[];
};
