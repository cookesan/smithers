import { Buffer } from "node:buffer";
import { SmithersError } from "@smithers-orchestrator/errors/SmithersError";
import { GATEWAY_RPC_LEGACY_METHOD_ALIASES, listGatewayRpcMethods } from "@smithers-orchestrator/gateway/rpc";
import { GATEWAY_SCOPE_VALUES, isGatewayScope } from "@smithers-orchestrator/gateway/auth/scopes";

const DEFAULT_MAX_BODY_BYTES = 1_048_576;
const DEFAULT_MAX_PAYLOAD_BYTES = DEFAULT_MAX_BODY_BYTES;
const DEFAULT_MAX_CONNECTIONS = 1_000;
const DEFAULT_HEADERS_TIMEOUT = 30_000;
const DEFAULT_REQUEST_TIMEOUT = 60_000;
const DEFAULT_MAX_TOKEN_TTL_MS = 1000 * 60 * 60 * 24 * 90;
const DEFAULT_MIN_JWT_SECRET_BYTES = 32;

const LEGACY_GATEWAY_SCOPES = new Set(["read", "execute", "approve", "admin"]);
const KNOWN_METHOD_SCOPE_VALUES = new Set([
    ...listGatewayRpcMethods(),
    ...Object.keys(GATEWAY_RPC_LEGACY_METHOD_ALIASES),
    "health",
    "approvals.list",
    "workflows.list",
    "runs.diff",
    "frames.list",
    "frames.get",
    "attempts.list",
    "attempts.get",
    "getDevToolsSnapshot",
    "runs.rerun",
    "approve",
]);

/** @type {Required<import("./GatewayProductionPolicy.js").GatewayProductionPolicy>} */
export const DEFAULT_GATEWAY_PRODUCTION_POLICY = {
    enabled: false,
    allowAnonymous: false,
    allowWildcardScopes: false,
    allowLegacyScopes: false,
    requireTokenExpiry: true,
    requireTokenIdentity: true,
    requireTrustedProxyOrigins: true,
    minJwtSecretBytes: DEFAULT_MIN_JWT_SECRET_BYTES,
    maxTokenTtlMs: DEFAULT_MAX_TOKEN_TTL_MS,
    maxBodyBytes: DEFAULT_MAX_BODY_BYTES,
    maxPayloadBytes: DEFAULT_MAX_PAYLOAD_BYTES,
    maxConnections: DEFAULT_MAX_CONNECTIONS,
};

/**
 * @param {boolean | import("./GatewayProductionPolicy.js").GatewayProductionPolicy | undefined} input
 * @returns {Required<import("./GatewayProductionPolicy.js").GatewayProductionPolicy>}
 */
export function normalizeGatewayProductionPolicy(input) {
    if (!input) {
        return { ...DEFAULT_GATEWAY_PRODUCTION_POLICY };
    }
    if (input === true) {
        return { ...DEFAULT_GATEWAY_PRODUCTION_POLICY, enabled: true };
    }
    return {
        ...DEFAULT_GATEWAY_PRODUCTION_POLICY,
        ...input,
        enabled: input.enabled ?? true,
    };
}

/**
 * @param {import("./GatewayReadinessReport.js").GatewayReadinessCheck[]} checks
 * @param {import("./GatewayReadinessReport.js").GatewayReadinessCheck["severity"]} severity
 * @param {string} id
 * @param {string} message
 * @param {Record<string, unknown>} [details]
 */
function addCheck(checks, severity, id, message, details) {
    checks.push({
        id,
        severity,
        message,
        ...(details ? { details } : {}),
    });
}

/**
 * @param {string} scope
 * @returns {boolean}
 */
function isKnownMethodScope(scope) {
    if (KNOWN_METHOD_SCOPE_VALUES.has(scope)) {
        return true;
    }
    if (!scope.endsWith(".*")) {
        return false;
    }
    const prefix = scope.slice(0, -1);
    return prefix.length > 0 && [...KNOWN_METHOD_SCOPE_VALUES].some((method) => method.startsWith(prefix));
}

/**
 * @param {string} scope
 * @param {string} path
 * @param {Required<import("./GatewayProductionPolicy.js").GatewayProductionPolicy>} policy
 * @param {import("./GatewayReadinessReport.js").GatewayReadinessCheck[]} checks
 */
function checkScope(scope, path, policy, checks) {
    const normalized = scope.trim();
    if (!normalized) {
        addCheck(checks, "error", "gateway.scope.empty", "Gateway grants must not include empty scopes.", { path });
        return;
    }
    if (normalized === "*") {
        if (!policy.allowWildcardScopes) {
            addCheck(checks, "error", "gateway.scope.wildcard", "Production Gateway grants must not use wildcard scopes.", { path });
        }
        return;
    }
    if (LEGACY_GATEWAY_SCOPES.has(normalized)) {
        if (!policy.allowLegacyScopes) {
            addCheck(checks, "error", "gateway.scope.legacy", "Production Gateway grants should use explicit v1 scopes instead of legacy broad scopes.", { path, scope: normalized });
        }
        return;
    }
    if (isGatewayScope(normalized) || isKnownMethodScope(normalized)) {
        return;
    }
    addCheck(checks, "error", "gateway.scope.unknown", "Gateway grant includes an unknown scope or method grant.", {
        path,
        scope: normalized,
        supportedScopes: GATEWAY_SCOPE_VALUES,
    });
}

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isRecord(value) {
    return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

/**
 * @param {unknown} value
 * @returns {string[]}
 */
function asStringArray(value) {
    return Array.isArray(value) ? value.filter((entry) => typeof entry === "string") : [];
}

/**
 * @param {unknown} value
 */
function isPositiveNumber(value) {
    return typeof value === "number" && Number.isFinite(value) && value > 0;
}

/**
 * @param {import("./GatewayOptions.js").GatewayOptions} options
 * @param {Required<import("./GatewayProductionPolicy.js").GatewayProductionPolicy>} policy
 * @param {import("./GatewayReadinessReport.js").GatewayReadinessCheck[]} checks
 */
function checkAuth(options, policy, checks) {
    const auth = options.auth;
    if (!auth) {
        if (!policy.allowAnonymous) {
            addCheck(checks, "error", "gateway.auth.required", "Production Gateway requires an auth mode.");
        }
        return;
    }
    switch (auth.mode) {
        case "token":
            checkTokenAuth(auth, policy, checks);
            return;
        case "jwt":
            checkJwtAuth(auth, policy, checks);
            return;
        case "trusted-proxy":
            checkTrustedProxyAuth(auth, policy, checks);
            return;
        default:
            addCheck(checks, "error", "gateway.auth.mode", "Gateway auth mode is not supported.", { mode: auth.mode });
    }
}

/**
 * @param {Extract<NonNullable<import("./GatewayOptions.js").GatewayOptions["auth"]>, { mode: "token" }>} auth
 * @param {Required<import("./GatewayProductionPolicy.js").GatewayProductionPolicy>} policy
 * @param {import("./GatewayReadinessReport.js").GatewayReadinessCheck[]} checks
 */
function checkTokenAuth(auth, policy, checks) {
    const tokens = isRecord(auth.tokens) ? auth.tokens : {};
    const entries = Object.entries(tokens);
    if (entries.length === 0) {
        addCheck(checks, "error", "gateway.auth.token.empty", "Token auth requires at least one grant.");
    }
    const now = Date.now();
    for (const [token, grant] of entries) {
        const tokenId = isRecord(grant) && typeof grant.tokenId === "string" ? grant.tokenId : undefined;
        const path = tokenId ? `auth.tokens.${tokenId}` : "auth.tokens";
        if (!token) {
            addCheck(checks, "error", "gateway.auth.token.empty_key", "Token grants must not use an empty token value.", { path });
        }
        if (!isRecord(grant)) {
            addCheck(checks, "error", "gateway.auth.token.grant", "Token grant must be an object.", { path });
            continue;
        }
        if (typeof grant.role !== "string" || !grant.role.trim()) {
            addCheck(checks, "error", "gateway.auth.token.role", "Token grant requires a non-empty role.", { path });
        }
        const scopes = asStringArray(grant.scopes);
        if (scopes.length === 0) {
            addCheck(checks, "error", "gateway.auth.token.scopes", "Token grant requires at least one scope.", { path });
        }
        for (const scope of scopes) {
            checkScope(scope, `${path}.scopes`, policy, checks);
        }
        if (policy.requireTokenIdentity) {
            if (typeof grant.userId !== "string" || !grant.userId.trim()) {
                addCheck(checks, "error", "gateway.auth.token.user_id", "Production token grants require a stable userId.", { path });
            }
            if (typeof grant.tokenId !== "string" || !grant.tokenId.trim()) {
                addCheck(checks, "error", "gateway.auth.token.token_id", "Production token grants require a stable tokenId.", { path });
            }
        }
        if (policy.requireTokenExpiry && typeof grant.expiresAtMs !== "number") {
            addCheck(checks, "error", "gateway.auth.token.expiry", "Production token grants require expiresAtMs.", { path });
        }
        if (typeof grant.expiresAtMs === "number" && grant.expiresAtMs <= now) {
            addCheck(checks, "error", "gateway.auth.token.expired", "Token grant is already expired.", { path, tokenId: grant.tokenId });
        }
        if (typeof grant.issuedAtMs === "number" && typeof grant.expiresAtMs === "number") {
            const ttlMs = grant.expiresAtMs - grant.issuedAtMs;
            if (ttlMs > policy.maxTokenTtlMs) {
                addCheck(checks, "error", "gateway.auth.token.ttl", "Token grant lifetime exceeds the production policy.", {
                    path,
                    ttlMs,
                    maxTokenTtlMs: policy.maxTokenTtlMs,
                });
            }
        }
        if (typeof grant.revokedAtMs === "number" && grant.revokedAtMs <= now) {
            addCheck(checks, "warning", "gateway.auth.token.revoked", "Revoked token grant is still present in the configured token map.", { path });
        }
    }
}

/**
 * @param {Extract<NonNullable<import("./GatewayOptions.js").GatewayOptions["auth"]>, { mode: "jwt" }>} auth
 * @param {Required<import("./GatewayProductionPolicy.js").GatewayProductionPolicy>} policy
 * @param {import("./GatewayReadinessReport.js").GatewayReadinessCheck[]} checks
 */
function checkJwtAuth(auth, policy, checks) {
    if (typeof auth.issuer !== "string" || !auth.issuer.trim()) {
        addCheck(checks, "error", "gateway.auth.jwt.issuer", "JWT auth requires an issuer.");
    }
    const audiences = Array.isArray(auth.audience) ? auth.audience : [auth.audience];
    if (audiences.length === 0 || audiences.some((audience) => typeof audience !== "string" || !audience.trim())) {
        addCheck(checks, "error", "gateway.auth.jwt.audience", "JWT auth requires at least one audience.");
    }
    const secretBytes = Buffer.byteLength(auth.secret ?? "", "utf8");
    if (secretBytes < policy.minJwtSecretBytes) {
        addCheck(checks, "error", "gateway.auth.jwt.secret", "JWT auth secret is shorter than the production policy.", {
            minJwtSecretBytes: policy.minJwtSecretBytes,
            actualBytes: secretBytes,
        });
    }
    for (const scope of auth.defaultScopes ?? []) {
        checkScope(scope, "auth.defaultScopes", policy, checks);
    }
    if (typeof auth.clockSkewSeconds === "number" && auth.clockSkewSeconds > 300) {
        addCheck(checks, "warning", "gateway.auth.jwt.clock_skew", "JWT clock skew is wider than five minutes.", {
            clockSkewSeconds: auth.clockSkewSeconds,
        });
    }
}

/**
 * @param {Extract<NonNullable<import("./GatewayOptions.js").GatewayOptions["auth"]>, { mode: "trusted-proxy" }>} auth
 * @param {Required<import("./GatewayProductionPolicy.js").GatewayProductionPolicy>} policy
 * @param {import("./GatewayReadinessReport.js").GatewayReadinessCheck[]} checks
 */
function checkTrustedProxyAuth(auth, policy, checks) {
    const allowedOrigins = auth.allowedOrigins ?? [];
    if (policy.requireTrustedProxyOrigins && allowedOrigins.length === 0) {
        addCheck(checks, "error", "gateway.auth.trusted_proxy.origins", "Trusted-proxy auth should pin allowed browser origins in production.");
    }
    for (const origin of allowedOrigins) {
        if (typeof origin !== "string" || !origin.startsWith("https://")) {
            addCheck(checks, "warning", "gateway.auth.trusted_proxy.origin_scheme", "Trusted-proxy allowed origins should use HTTPS.", { origin });
        }
    }
    const defaultScopes = auth.defaultScopes ?? ["*"];
    for (const scope of defaultScopes) {
        checkScope(scope, "auth.defaultScopes", policy, checks);
    }
}

/**
 * @param {import("./GatewayOptions.js").GatewayOptions} options
 * @param {Required<import("./GatewayProductionPolicy.js").GatewayProductionPolicy>} policy
 * @param {import("./GatewayReadinessReport.js").GatewayReadinessCheck[]} checks
 */
function checkLimits(options, policy, checks) {
    const maxBodyBytes = options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;
    const maxPayloadBytes = options.maxPayload ?? DEFAULT_MAX_PAYLOAD_BYTES;
    const maxConnections = options.maxConnections ?? DEFAULT_MAX_CONNECTIONS;
    const headersTimeout = options.headersTimeout ?? DEFAULT_HEADERS_TIMEOUT;
    const requestTimeout = options.requestTimeout ?? DEFAULT_REQUEST_TIMEOUT;
    if (!isPositiveNumber(maxBodyBytes)) {
        addCheck(checks, "error", "gateway.limits.max_body", "Gateway maxBodyBytes must be a positive number.");
    }
    else if (maxBodyBytes > policy.maxBodyBytes) {
        addCheck(checks, "error", "gateway.limits.max_body", "Gateway maxBodyBytes exceeds the production policy.", {
            maxBodyBytes,
            policyMaxBodyBytes: policy.maxBodyBytes,
        });
    }
    if (!isPositiveNumber(maxPayloadBytes)) {
        addCheck(checks, "error", "gateway.limits.max_payload", "Gateway maxPayload must be a positive number.");
    }
    else if (maxPayloadBytes > policy.maxPayloadBytes) {
        addCheck(checks, "error", "gateway.limits.max_payload", "Gateway maxPayload exceeds the production policy.", {
            maxPayloadBytes,
            policyMaxPayloadBytes: policy.maxPayloadBytes,
        });
    }
    if (!isPositiveNumber(maxConnections)) {
        addCheck(checks, "error", "gateway.limits.max_connections", "Gateway maxConnections must be a positive number.");
    }
    else if (maxConnections > policy.maxConnections) {
        addCheck(checks, "warning", "gateway.limits.max_connections", "Gateway maxConnections is higher than the production policy.", {
            maxConnections,
            policyMaxConnections: policy.maxConnections,
        });
    }
    if (!isPositiveNumber(headersTimeout) || !isPositiveNumber(requestTimeout)) {
        addCheck(checks, "error", "gateway.limits.timeouts", "Gateway headersTimeout and requestTimeout must be positive numbers.");
    }
    else if (requestTimeout < headersTimeout) {
        addCheck(checks, "warning", "gateway.limits.timeouts", "Gateway requestTimeout is lower than headersTimeout.", {
            headersTimeout,
            requestTimeout,
        });
    }
}

/**
 * Build a structured production readiness report for Gateway options.
 *
 * @param {import("./GatewayOptions.js").GatewayOptions} [options]
 * @param {boolean | import("./GatewayProductionPolicy.js").GatewayProductionPolicy} [production]
 * @returns {import("./GatewayReadinessReport.js").GatewayReadinessReport}
 */
export function getGatewayReadinessReport(options = {}, production = options.production ?? true) {
    const policy = normalizeGatewayProductionPolicy(production);
    /** @type {import("./GatewayReadinessReport.js").GatewayReadinessCheck[]} */
    const checks = [];
    checkAuth(options, policy, checks);
    checkLimits(options, policy, checks);
    const status = checks.some((check) => check.severity === "error")
        ? "fail"
        : checks.some((check) => check.severity === "warning")
            ? "warn"
            : "pass";
    return {
        status,
        production: policy.enabled,
        checkedAtMs: Date.now(),
        checks,
    };
}

/**
 * @param {import("./GatewayOptions.js").GatewayOptions} options
 * @param {boolean | import("./GatewayProductionPolicy.js").GatewayProductionPolicy} [production]
 * @returns {import("./GatewayReadinessReport.js").GatewayReadinessReport}
 */
export function assertGatewayProductionReady(options, production = options.production ?? true) {
    const report = getGatewayReadinessReport(options, production);
    if (report.status === "fail") {
        throw new SmithersError("GATEWAY_NOT_PRODUCTION_READY", "Gateway production readiness checks failed.", {
            checks: report.checks,
        });
    }
    return report;
}

/**
 * @param {import("./GatewayOptions.js").GatewayOptions} options
 * @param {Partial<import("./GatewayOptions.js").GatewayOptions>} resolved
 */
export function assertResolvedGatewayProductionReady(options, resolved) {
    const production = normalizeGatewayProductionPolicy(options.production);
    if (production.enabled) {
        assertGatewayProductionReady({ ...options, ...resolved }, production);
    }
}
