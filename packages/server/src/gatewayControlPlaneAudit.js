import { createHash } from "node:crypto";
import { SmithersError } from "@smithers-orchestrator/errors/SmithersError";
import { nowMs } from "@smithers-orchestrator/scheduler/nowMs";

const CONTROL_PLANE_AUDIT_ID_PATTERN = /^[A-Za-z0-9:_-]{1,128}$/;

/**
 * @param {unknown} value
 * @returns {string | null}
 */
function controlPlaneAuditId(value) {
    if (typeof value !== "string" || value.length === 0) {
        return null;
    }
    if (CONTROL_PLANE_AUDIT_ID_PATTERN.test(value)) {
        return value;
    }
    return `hash:${createHash("sha256").update(value).digest("hex").slice(0, 24)}`;
}

/**
 * @param {unknown} value
 * @returns {Record<string, unknown> | null}
 */
function asObject(value) {
    return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

/**
 * @param {unknown} value
 * @returns {string | undefined}
 */
function asString(value) {
    return typeof value === "string" ? value : undefined;
}

/**
 * @param {unknown} value
 * @returns {number | undefined}
 */
function asNumber(value) {
    return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/**
 * @param {unknown} value
 * @returns {boolean | undefined}
 */
function asBoolean(value) {
    return typeof value === "boolean" ? value : undefined;
}

/**
 * @param {import("./GatewayControlPlaneAuditConfig.js").GatewayControlPlaneAuditConfig | undefined} config
 * @returns {import("./GatewayControlPlaneAuditConfig.js").GatewayControlPlaneAuditConfig | null}
 */
export function resolveGatewayControlPlaneAuditConfig(config) {
    if (!config) {
        return null;
    }
    if (!config.store || typeof config.store.recordAuditEvent !== "function") {
        throw new SmithersError("INVALID_INPUT", "Gateway controlPlane.store must expose recordAuditEvent().");
    }
    if (!controlPlaneAuditId(config.orgId) || config.orgId !== controlPlaneAuditId(config.orgId)) {
        throw new SmithersError("INVALID_INPUT", "Gateway controlPlane.orgId must be a stable control-plane id.");
    }
    if (config.projectId !== undefined && config.projectId !== null &&
        (!controlPlaneAuditId(config.projectId) || config.projectId !== controlPlaneAuditId(config.projectId))) {
        throw new SmithersError("INVALID_INPUT", "Gateway controlPlane.projectId must be a stable control-plane id.");
    }
    return config;
}

/**
 * @param {import("./GatewayControlPlaneAuditConfig.js").GatewayControlPlaneAuditConfig | null} controlPlane
 * @param {{ actorId?: string | null; action: string; targetType: string; targetId?: string | null; metadata?: Record<string, unknown> }} event
 * @param {(error: unknown, event: { action: string; targetType: string }) => void} [onError]
 */
export function recordGatewayControlPlaneAuditEvent(controlPlane, event, onError) {
    if (!controlPlane) {
        return;
    }
    try {
        controlPlane.store.recordAuditEvent({
            orgId: controlPlane.orgId,
            projectId: controlPlane.projectId ?? null,
            actorId: controlPlaneAuditId(event.actorId ?? null),
            action: event.action,
            targetType: event.targetType,
            targetId: controlPlaneAuditId(event.targetId ?? null),
            occurredAtMs: nowMs(),
            metadata: {
                ...controlPlane.metadata,
                ...event.metadata,
            },
        });
    }
    catch (error) {
        onError?.(error, event);
    }
}

/**
 * @param {string} triggeredBy
 */
function gatewayTriggerSource(triggeredBy) {
    if (triggeredBy.startsWith("cron:")) return "cron";
    if (triggeredBy.startsWith("webhook:")) return "webhook";
    if (triggeredBy === "gateway") return "gateway";
    return "user";
}

/**
 * @param {import("./GatewayControlPlaneAuditConfig.js").GatewayControlPlaneAuditConfig | null} controlPlane
 * @param {string} transport
 * @param {"success" | "failure"} outcome
 * @param {import("./gateway.js").GatewayRequestContext} context
 * @param {Record<string, unknown>} details
 * @param {string} authMode
 * @param {(error: unknown, event: { action: string; targetType: string }) => void} [onError]
 */
export function recordGatewayControlPlaneAuthEvent(controlPlane, transport, outcome, context, details, authMode, onError) {
    recordGatewayControlPlaneAuditEvent(controlPlane, {
        actorId: context.userId ?? null,
        action: outcome === "success" ? "gateway.auth.success" : "gateway.auth.failure",
        targetType: "gateway_connection",
        targetId: context.connectionId ?? null,
        metadata: {
            transport,
            authMode,
            outcome,
            role: context.role ?? null,
            tokenId: context.tokenId ?? null,
            ...details,
        },
    }, onError);
}

/**
 * @param {import("./GatewayControlPlaneAuditConfig.js").GatewayControlPlaneAuditConfig | null} controlPlane
 * @param {{ workflowKey: string; runId: string; auth: { triggeredBy: string; role: string; tokenId?: string | null }; resume?: boolean }} event
 * @param {(error: unknown, event: { action: string; targetType: string }) => void} [onError]
 */
export function recordGatewayControlPlaneRunStartEvent(controlPlane, event, onError) {
    const source = gatewayTriggerSource(event.auth.triggeredBy);
    if (source !== "cron" && source !== "webhook") {
        return;
    }
    recordGatewayControlPlaneAuditEvent(controlPlane, {
        actorId: event.auth.triggeredBy,
        action: event.resume ? "gateway.run.resume" : "gateway.run.launch",
        targetType: "run",
        targetId: event.runId,
        metadata: {
            workflow: event.workflowKey,
            source,
            resume: event.resume ?? false,
            role: event.auth.role,
            tokenId: event.auth.tokenId ?? null,
        },
    }, onError);
}

/**
 * @param {import("./GatewayControlPlaneAuditConfig.js").GatewayControlPlaneAuditConfig | null} controlPlane
 * @param {{ workflowKey: string; runId: string; triggeredBy: string; signal: { signalName?: string; correlationId?: string | null } }} event
 * @param {(error: unknown, event: { action: string; targetType: string }) => void} [onError]
 */
export function recordGatewayControlPlaneWebhookSignalEvent(controlPlane, event, onError) {
    recordGatewayControlPlaneAuditEvent(controlPlane, {
        actorId: event.triggeredBy,
        action: "gateway.webhook.signal",
        targetType: "run",
        targetId: event.runId,
        metadata: {
            workflow: event.workflowKey,
            signalName: event.signal.signalName ?? null,
            correlationId: event.signal.correlationId ?? null,
        },
    }, onError);
}

/**
 * @param {import("./GatewayControlPlaneAuditConfig.js").GatewayControlPlaneAuditConfig | null} controlPlane
 * @param {import("./gateway.js").GatewayRequestContext} context
 * @param {import("./RequestFrame.js").RequestFrame} frame
 * @param {import("./ResponseFrame.js").ResponseFrame} response
 * @param {(error: unknown, event: { action: string; targetType: string }) => void} [onError]
 */
export function recordGatewayControlPlaneRpcAuditEvent(controlPlane, context, frame, response, onError) {
    const params = asObject(frame.params) ?? {};
    const payload = asObject(response.payload) ?? {};
    const runId = asString(params.runId) ?? asString(payload.runId);
    const workflow = asString(params.workflow) ?? asString(payload.workflow);
    const actorId = context.userId ?? null;
    const metadata = {
        transport: context.transport ?? null,
        method: frame.method,
        role: context.role ?? null,
        tokenId: context.tokenId ?? null,
        ...(workflow ? { workflow } : {}),
    };
    const record = (event) => recordGatewayControlPlaneAuditEvent(controlPlane, event, onError);
    switch (frame.method) {
        case "runs.create":
        case "launchRun":
            record({ actorId, action: "gateway.run.launch", targetType: "run", targetId: asString(payload.runId), metadata });
            return;
        case "resumeRun":
            record({ actorId, action: "gateway.run.resume", targetType: "run", targetId: runId, metadata });
            return;
        case "runs.cancel":
        case "cancelRun":
            record({ actorId, action: "gateway.run.cancel", targetType: "run", targetId: runId, metadata });
            return;
        case "hijackRun":
            record({ actorId, action: "gateway.run.hijack", targetType: "run", targetId: runId, metadata });
            return;
        case "rewindRun":
        case "jumpToFrame":
        case "devtools.jumpToFrame":
            record({ actorId, action: "gateway.run.rewind", targetType: "run", targetId: runId, metadata: { ...metadata, frameNo: asNumber(params.frameNo) ?? null } });
            return;
        case "runs.rerun":
            record({ actorId, action: "gateway.run.rerun", targetType: "run", targetId: asString(payload.runId) ?? runId, metadata: { ...metadata, sourceRunId: runId ?? null } });
            return;
        case "approvals.decide":
        case "submitApproval": {
            const nodeId = asString(params.nodeId);
            const iteration = asNumber(params.iteration) ?? 0;
            record({
                actorId,
                action: "gateway.approval.submit",
                targetType: "approval",
                targetId: runId && nodeId ? `${runId}:${nodeId}:${iteration}` : runId,
                metadata: {
                    ...metadata,
                    runId: runId ?? null,
                    nodeId: nodeId ?? null,
                    iteration,
                    approved: asBoolean(params.approved) ?? asBoolean(asObject(params.decision)?.approved) ?? null,
                },
            });
            return;
        }
        case "signals.send":
        case "submitSignal":
            record({
                actorId,
                action: "gateway.signal.submit",
                targetType: "run",
                targetId: runId,
                metadata: {
                    ...metadata,
                    signalName: asString(params.signalName) ?? asString(params.correlationKey) ?? null,
                    correlationId: asString(params.correlationId) ?? asString(params.correlationKey) ?? null,
                },
            });
            return;
        case "cron.add":
        case "cronCreate":
            record({ actorId, action: "gateway.cron.create", targetType: "cron", targetId: asString(payload.cronId) ?? asString(params.cronId), metadata });
            return;
        case "cron.remove":
        case "cronDelete":
            record({ actorId, action: "gateway.cron.delete", targetType: "cron", targetId: asString(params.cronId), metadata });
            return;
        case "cron.trigger":
        case "cronRun":
            record({
                actorId,
                action: "gateway.cron.run",
                targetType: asString(payload.runId) ? "run" : "cron",
                targetId: asString(payload.runId) ?? asString(params.cronId) ?? workflow,
                metadata: { ...metadata, cronId: asString(params.cronId) ?? null },
            });
            return;
    }
}
