import { describe, expect, test } from "bun:test";
import { createTempRepo, runSmithers } from "../../../packages/smithers/tests/e2e-helpers.js";

function validGatewayConfig() {
    return {
        auth: {
            mode: "token",
            tokens: {
                "token-secret": {
                    role: "operator",
                    scopes: ["run:read", "run:write"],
                    userId: "user:operator",
                    tokenId: "tok_operator",
                    issuedAtMs: Date.now(),
                    expiresAtMs: Date.now() + 60 * 60 * 1000,
                },
            },
        },
    };
}

describe("smithers gateway doctor", () => {
    test("prints a passing human readiness report for a valid config", () => {
        const repo = createTempRepo();
        repo.write("gateway.json", `${JSON.stringify(validGatewayConfig(), null, 2)}\n`);

        const result = runSmithers(["gateway", "doctor", "--config", "gateway.json"], {
            cwd: repo.dir,
            format: null,
        });

        expect(result.exitCode).toBe(0);
        expect(result.stdout).toContain("Gateway readiness:");
        expect(result.stdout).toContain("pass");
    });

    test("prints JSON and exits non-zero when production checks fail", () => {
        const repo = createTempRepo();
        const result = runSmithers(["gateway", "doctor", "--json"], {
            cwd: repo.dir,
            format: null,
        });

        expect(result.exitCode).toBe(1);
        const report = JSON.parse(result.stdout);
        expect(report.status).toBe("fail");
        expect(report.checks.map((check) => check.id)).toContain("gateway.auth.required");
    });
});
