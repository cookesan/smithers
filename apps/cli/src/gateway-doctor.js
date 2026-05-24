import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { SmithersError } from "@smithers-orchestrator/errors";
import { Cli, z } from "incur";
import pc from "picocolors";

const gatewayDoctorOptions = z.object({
    config: z.string().optional().describe("Path to a JSON file containing GatewayOptions"),
    production: z.boolean().default(true).describe("Run production readiness checks"),
    json: z.boolean().default(false).describe("Print the readiness report as JSON"),
});

/**
 * @param {string | undefined} configPath
 * @returns {Record<string, unknown>}
 */
function readGatewayDoctorConfig(configPath) {
    if (!configPath) {
        return {};
    }
    const absPath = resolve(process.cwd(), configPath);
    let parsed;
    try {
        parsed = JSON.parse(readFileSync(absPath, "utf8"));
    }
    catch (error) {
        throw new SmithersError("GATEWAY_DOCTOR_CONFIG_INVALID", `Could not read Gateway config JSON at ${absPath}: ${error?.message ?? String(error)}`);
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new SmithersError("GATEWAY_DOCTOR_CONFIG_INVALID", "Gateway doctor config must be a JSON object.");
    }
    return parsed;
}

/**
 * @param {import("@smithers-orchestrator/server").GatewayReadinessReport} report
 */
function formatGatewayReadinessReport(report) {
    const statusColor = report.status === "pass" ? pc.green : report.status === "warn" ? pc.yellow : pc.red;
    const lines = [`Gateway readiness: ${statusColor(report.status)}`];
    if (report.checks.length === 0) {
        lines.push("  All checks passed.");
        return lines.join("\n");
    }
    for (const check of report.checks) {
        const label = check.severity === "error"
            ? pc.red("[error]")
            : check.severity === "warning"
                ? pc.yellow("[warning]")
                : pc.dim("[info]");
        lines.push(`  ${label} ${check.id}: ${check.message}`);
    }
    return lines.join("\n");
}

/**
 * @param {{ setExitCode?: (exitCode: number) => void }} [options]
 */
export function createGatewayCli(options = {}) {
    return Cli.create({
        name: "gateway",
        description: "Inspect Gateway deployment configuration.",
    })
        .command("doctor", {
        description: "Validate Gateway readiness before exposing it in production.",
        options: gatewayDoctorOptions,
        async run(c) {
            const fail = (opts) => {
                options.setExitCode?.(opts.exitCode ?? 1);
                return c.error(opts);
            };
            try {
                const gatewayOptions = readGatewayDoctorConfig(c.options.config);
                const { getGatewayReadinessReport } = await import("@smithers-orchestrator/server");
                const production = c.options.production ? gatewayOptions.production ?? true : false;
                const report = getGatewayReadinessReport({
                    ...gatewayOptions,
                    production,
                }, production);
                options.setExitCode?.(report.status === "fail" ? 1 : 0);
                if (c.options.json || c.format === "json") {
                    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
                }
                else {
                    process.stdout.write(`${formatGatewayReadinessReport(report)}\n`);
                }
                return c.ok(undefined);
            }
            catch (err) {
                return fail({
                    code: err instanceof SmithersError ? err.code : "GATEWAY_DOCTOR_FAILED",
                    message: err?.message ?? String(err),
                    exitCode: 1,
                });
            }
        },
    });
}
