export type GatewayControlPlaneAuditStore = {
  recordAuditEvent(input: {
    orgId: string;
    projectId?: string | null;
    actorId?: string | null;
    action: string;
    targetType: string;
    targetId?: string | null;
    occurredAtMs?: number;
    metadata?: Record<string, unknown>;
  }): unknown;
};

export type GatewayControlPlaneAuditConfig = {
  store: GatewayControlPlaneAuditStore;
  orgId: string;
  projectId?: string | null;
  metadata?: Record<string, unknown>;
};
