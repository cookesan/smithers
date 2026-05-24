import { describe, expect, test } from "bun:test";
import { Gateway } from "../src/gateway.js";
import { assertGatewayProductionReady, getGatewayReadinessReport, normalizeGatewayProductionPolicy } from "../src/gatewayReadiness.js";

const VALID_TOKEN_AUTH = {
    mode: "token",
    tokens: {
        "token-secret": {
            role: "operator",
            scopes: ["run:read", "run:write"],
            userId: "user:will",
            tokenId: "tok_prod",
            issuedAtMs: Date.now(),
            expiresAtMs: Date.now() + 60 * 60 * 1000,
        },
    },
};

describe("Gateway production readiness", () => {
    test("normalizes production policy defaults", () => {
        expect(normalizeGatewayProductionPolicy(undefined).enabled).toBe(false);
        expect(normalizeGatewayProductionPolicy(true).enabled).toBe(true);
        expect(normalizeGatewayProductionPolicy({ allowWildcardScopes: true })).toMatchObject({
            enabled: true,
            allowWildcardScopes: true,
        });
    });

    test("reports missing auth as a production failure", () => {
        const report = getGatewayReadinessReport({});

        expect(report.status).toBe("fail");
        expect(report.checks.map((check) => check.id)).toContain("gateway.auth.required");
    });

    test("accepts a bounded token auth configuration", () => {
        const report = getGatewayReadinessReport({ auth: VALID_TOKEN_AUTH });

        expect(report.status).toBe("pass");
        expect(report.checks).toEqual([]);
    });

    test("rejects wildcard and legacy scopes by default", () => {
        const report = getGatewayReadinessReport({
            auth: {
                mode: "token",
                tokens: {
                    "token-secret": {
                        role: "admin",
                        scopes: ["*", "admin"],
                        userId: "user:admin",
                        tokenId: "tok_admin",
                        issuedAtMs: Date.now(),
                        expiresAtMs: Date.now() + 60 * 60 * 1000,
                    },
                },
            },
        });

        expect(report.status).toBe("fail");
        expect(report.checks.map((check) => check.id)).toEqual(expect.arrayContaining([
            "gateway.scope.wildcard",
            "gateway.scope.legacy",
        ]));
    });

    test("requires token expiry and identity in production", () => {
        const report = getGatewayReadinessReport({
            auth: {
                mode: "token",
                tokens: {
                    "token-secret": {
                        role: "operator",
                        scopes: ["run:read"],
                    },
                },
            },
        });

        expect(report.status).toBe("fail");
        expect(report.checks.map((check) => check.id)).toEqual(expect.arrayContaining([
            "gateway.auth.token.user_id",
            "gateway.auth.token.token_id",
            "gateway.auth.token.expiry",
        ]));
    });

    test("checks JWT issuer, audience, secret, and default scopes", () => {
        const report = getGatewayReadinessReport({
            auth: {
                mode: "jwt",
                issuer: "",
                audience: "",
                secret: "short",
                defaultScopes: ["missing:scope"],
            },
        });

        expect(report.status).toBe("fail");
        expect(report.checks.map((check) => check.id)).toEqual(expect.arrayContaining([
            "gateway.auth.jwt.issuer",
            "gateway.auth.jwt.audience",
            "gateway.auth.jwt.secret",
            "gateway.scope.unknown",
        ]));
    });

    test("checks trusted proxy origins and implicit wildcard defaults", () => {
        const report = getGatewayReadinessReport({
            auth: {
                mode: "trusted-proxy",
            },
        });

        expect(report.status).toBe("fail");
        expect(report.checks.map((check) => check.id)).toEqual(expect.arrayContaining([
            "gateway.auth.trusted_proxy.origins",
            "gateway.scope.wildcard",
        ]));
    });

    test("checks production size limits", () => {
        const report = getGatewayReadinessReport({
            auth: VALID_TOKEN_AUTH,
            maxBodyBytes: 2 * 1024 * 1024,
            maxPayload: 2 * 1024 * 1024,
        });

        expect(report.status).toBe("fail");
        expect(report.checks.map((check) => check.id)).toEqual(expect.arrayContaining([
            "gateway.limits.max_body",
            "gateway.limits.max_payload",
        ]));
    });

    test("Gateway constructor enforces production readiness only when enabled", () => {
        expect(() => new Gateway()).not.toThrow();
        expect(() => new Gateway({ production: true })).toThrow(/production readiness/i);
        expect(() => new Gateway({ production: true, auth: VALID_TOKEN_AUTH })).not.toThrow();
    });

    test("assertGatewayProductionReady returns the passing report", () => {
        const report = assertGatewayProductionReady({ auth: VALID_TOKEN_AUTH });

        expect(report.status).toBe("pass");
    });
});
