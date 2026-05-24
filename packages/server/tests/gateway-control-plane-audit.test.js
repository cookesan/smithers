import { describe, expect, test } from "bun:test";
import { Gateway } from "../src/gateway.js";

class MemoryAuditStore {
    events = [];

    recordAuditEvent(input) {
        this.events.push(input);
        return input;
    }
}

function auditGateway(store = new MemoryAuditStore()) {
    return {
        store,
        gateway: new Gateway({
            controlPlane: {
                store,
                orgId: "org_test",
                projectId: "project_test",
                metadata: { deploymentId: "dep_1" },
            },
        }),
    };
}

const context = {
    connectionId: "http:req_1",
    transport: "http",
    role: "operator",
    scopes: ["run:write"],
    userId: "user:operator",
    tokenId: "tok_operator",
};

describe("Gateway control-plane audit integration", () => {
    test("records auth success and failure without token values", () => {
        const { gateway, store } = auditGateway();

        gateway.recordAuthEvent("http", "success", context, {
            requestId: "req_1",
            scopeCount: 1,
        });
        gateway.recordAuthEvent("http", "failure", {
            ...context,
            userId: null,
            tokenId: null,
        }, {
            requestId: "req_2",
            authCode: "UNAUTHORIZED",
            authMessage: "Invalid token",
        });

        expect(store.events.map((event) => event.action)).toEqual([
            "gateway.auth.success",
            "gateway.auth.failure",
        ]);
        expect(JSON.stringify(store.events)).not.toContain("token-secret");
        expect(store.events[0]).toMatchObject({
            orgId: "org_test",
            projectId: "project_test",
            actorId: "user:operator",
            targetType: "gateway_connection",
            metadata: {
                deploymentId: "dep_1",
                tokenId: "tok_operator",
            },
        });
    });

    test("records successful mutating RPC events", async () => {
        const { gateway, store } = auditGateway();

        await gateway.executeRpc(context, {
            type: "req",
            id: "launch",
            method: "launchRun",
            params: { workflow: "deploy" },
        }, async () => ({
            type: "res",
            id: "launch",
            ok: true,
            apiVersion: "v1",
            payload: { runId: "run_1", workflow: "deploy" },
        }));
        await gateway.executeRpc(context, {
            type: "req",
            id: "approval",
            method: "submitApproval",
            params: {
                runId: "run_1",
                nodeId: "approve",
                iteration: 0,
                decision: { approved: true },
            },
        }, async () => ({
            type: "res",
            id: "approval",
            ok: true,
            apiVersion: "v1",
            payload: { runId: "run_1", nodeId: "approve", iteration: 0, approved: true },
        }));

        expect(store.events.map((event) => event.action)).toEqual([
            "gateway.run.launch",
            "gateway.approval.submit",
        ]);
        expect(store.events[0]).toMatchObject({
            targetType: "run",
            targetId: "run_1",
            actorId: "user:operator",
            metadata: {
                method: "launchRun",
                workflow: "deploy",
                tokenId: "tok_operator",
            },
        });
        expect(store.events[1]).toMatchObject({
            targetType: "approval",
            targetId: "run_1:approve:0",
            metadata: {
                approved: true,
                nodeId: "approve",
            },
        });
    });

    test("hashes actor and target ids that are not valid control-plane ids", () => {
        const { gateway, store } = auditGateway();

        gateway.recordAuthEvent("http", "success", {
            ...context,
            connectionId: "connection with spaces",
            userId: "person@example.com",
        });

        expect(store.events[0].actorId).toMatch(/^hash:[a-f0-9]{24}$/);
        expect(store.events[0].targetId).toMatch(/^hash:[a-f0-9]{24}$/);
    });

    test("validates control-plane audit config at construction", () => {
        expect(() => new Gateway({
            controlPlane: {
                store: {},
                orgId: "org_test",
            },
        })).toThrow(/recordAuditEvent/);
    });
});
