import { describe, expect, test } from "bun:test";
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { Window } from "happy-dom";
import {
  SmithersGatewayContext,
  SmithersGatewayProvider,
  useGatewayActions,
  useGatewayRpc,
  useSmithersGateway,
} from "../src/index.ts";
import type { SmithersGatewayClient } from "@smithers-orchestrator/gateway-client";

const window = new Window();
const globalWithDom = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
  window: Window;
  document: Document;
  HTMLElement: typeof HTMLElement;
  Node: typeof Node;
  Event: typeof Event;
  navigator: Navigator;
};
globalWithDom.IS_REACT_ACT_ENVIRONMENT = true;
globalWithDom.window = window;
globalWithDom.document = window.document as unknown as Document;
globalWithDom.HTMLElement = window.HTMLElement as unknown as typeof HTMLElement;
globalWithDom.Node = window.Node as unknown as typeof Node;
globalWithDom.Event = window.Event as unknown as typeof Event;
globalWithDom.navigator = window.navigator as unknown as Navigator;

async function flushEffects() {
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

async function renderClient(element: ReactElement) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root: Root = createRoot(container);
  await act(async () => {
    root.render(element);
    await flushEffects();
  });
  return {
    update: async (next: ReactElement) => {
      await act(async () => {
        root.render(next);
        await flushEffects();
      });
    },
    unmount: async () => {
      await act(async () => {
        root.unmount();
        await flushEffects();
      });
      container.remove();
    },
  };
}

function createSpyClient() {
  const calls: string[] = [];
  const client = {
    launchRun: () => calls.push("launchRun"),
    resumeRun: () => calls.push("resumeRun"),
    cancelRun: () => calls.push("cancelRun"),
    hijackRun: () => calls.push("hijackRun"),
    rewindRun: () => calls.push("rewindRun"),
    submitApproval: () => calls.push("submitApproval"),
    submitSignal: () => calls.push("submitSignal"),
    cronCreate: () => calls.push("cronCreate"),
    cronDelete: () => calls.push("cronDelete"),
    cronRun: () => calls.push("cronRun"),
  } as unknown as SmithersGatewayClient;
  return { client, calls };
}

function createRpcClient() {
  const calls: Array<{ method: string; params: unknown }> = [];
  const client = {
    rpc: async (method: string, params: unknown) => {
      calls.push({ method, params });
      return { call: calls.length, params };
    },
  } as unknown as SmithersGatewayClient;
  return { client, calls };
}

function createDeferredRpcClient() {
  const calls: Array<{
    method: string;
    params: unknown;
    signal: AbortSignal | undefined;
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
  }> = [];
  const client = {
    rpc: (method: string, params: unknown, options?: { signal?: AbortSignal }) =>
      new Promise((resolve, reject) => {
        calls.push({ method, params, signal: options?.signal, resolve, reject });
      }),
  } as unknown as SmithersGatewayClient;
  return { client, calls };
}

describe("SmithersGatewayProvider", () => {
  test("provides an explicit client through context", async () => {
    const { client } = createSpyClient();
    let observed: SmithersGatewayClient | null = null;

    const root = await renderClient(createElement(
      SmithersGatewayProvider,
      { client },
      createElement(SmithersGatewayContext.Consumer, {
        children: (value: SmithersGatewayClient | null) => {
          observed = value;
          return null;
        },
      }),
    ));

    expect(observed).toBe(client);
    await root.unmount();
  });
});

describe("useSmithersGateway", () => {
  test("throws a clear error outside the provider", async () => {
    function Probe() {
      useSmithersGateway();
      return null;
    }

    expect(() => renderToString(createElement(Probe))).toThrow(
      "useSmithersGateway() must be used inside <SmithersGatewayProvider>.",
    );
  });
});

describe("useGatewayActions", () => {
  test("exposes write helpers for the full stable gateway action surface", async () => {
    const { client, calls } = createSpyClient();
    let actions: ReturnType<typeof useGatewayActions> | undefined;

    function Probe() {
      actions = useGatewayActions();
      return null;
    }

    const root = await renderClient(createElement(SmithersGatewayProvider, { client }, createElement(Probe)));

    expect(actions).toBeDefined();
    actions?.launchRun({ workflow: "deploy" });
    actions?.resumeRun({ runId: "run-1" });
    actions?.cancelRun({ runId: "run-1" });
    actions?.hijackRun({ runId: "run-1" });
    actions?.rewindRun({ runId: "run-1", frameNo: 1, confirm: true });
    actions?.submitApproval({
      runId: "run-1",
      nodeId: "approve",
      decision: { approved: true },
    });
    actions?.submitSignal({ runId: "run-1", correlationKey: "signal-1" });
    actions?.cronCreate({ workflow: "deploy", pattern: "* * * * *" });
    actions?.cronDelete({ cronId: "cron-1" });
    actions?.cronRun({ workflow: "deploy" });

    expect(calls).toEqual([
      "launchRun",
      "resumeRun",
      "cancelRun",
      "hijackRun",
      "rewindRun",
      "submitApproval",
      "submitSignal",
      "cronCreate",
      "cronDelete",
      "cronRun",
    ]);

    await root.unmount();
  });
});

describe("useGatewayRpc", () => {
  test("refetches when params change by default", async () => {
    const { client, calls } = createRpcClient();
    let state: ReturnType<typeof useGatewayRpc<"getRun">> | undefined;

    function Probe(props: { runId: string }) {
      state = useGatewayRpc("getRun", { runId: props.runId });
      return null;
    }

    const root = await renderClient(
      createElement(SmithersGatewayProvider, { client }, createElement(Probe, { runId: "run-1" })),
    );

    expect(calls).toEqual([{ method: "getRun", params: { runId: "run-1" } }]);
    expect(state?.data).toEqual({ call: 1, params: { runId: "run-1" } });

    await root.update(createElement(SmithersGatewayProvider, { client }, createElement(Probe, { runId: "run-2" })));

    expect(calls).toEqual([
      { method: "getRun", params: { runId: "run-1" } },
      { method: "getRun", params: { runId: "run-2" } },
    ]);
    expect(state?.data).toEqual({ call: 2, params: { runId: "run-2" } });

    await root.unmount();
  });

  test("honors custom deps while manual refetch uses latest params", async () => {
    const { client, calls } = createRpcClient();
    let state: ReturnType<typeof useGatewayRpc<"getRun">> | undefined;

    function Probe(props: { runId: string; revision: number }) {
      state = useGatewayRpc("getRun", { runId: props.runId }, { deps: [props.revision] });
      return null;
    }

    const root = await renderClient(createElement(
      SmithersGatewayProvider,
      { client },
      createElement(Probe, { runId: "run-1", revision: 1 }),
    ));

    await root.update(createElement(
      SmithersGatewayProvider,
      { client },
      createElement(Probe, { runId: "run-2", revision: 1 }),
    ));

    expect(calls).toEqual([{ method: "getRun", params: { runId: "run-1" } }]);

    await act(async () => {
      await state?.refetch();
    });

    expect(calls).toEqual([
      { method: "getRun", params: { runId: "run-1" } },
      { method: "getRun", params: { runId: "run-2" } },
    ]);

    await root.update(createElement(
      SmithersGatewayProvider,
      { client },
      createElement(Probe, { runId: "run-3", revision: 2 }),
    ));

    expect(calls).toEqual([
      { method: "getRun", params: { runId: "run-1" } },
      { method: "getRun", params: { runId: "run-2" } },
      { method: "getRun", params: { runId: "run-3" } },
    ]);

    await root.unmount();
  });

  test("waits for enabled before fetching", async () => {
    const { client, calls } = createRpcClient();
    let state: ReturnType<typeof useGatewayRpc<"getRun">> | undefined;

    function Probe(props: { enabled: boolean }) {
      state = useGatewayRpc("getRun", { runId: "run-1" }, { enabled: props.enabled });
      return null;
    }

    const root = await renderClient(
      createElement(SmithersGatewayProvider, { client }, createElement(Probe, { enabled: false })),
    );

    expect(calls).toEqual([]);
    expect(state?.loading).toBe(false);

    await root.update(createElement(SmithersGatewayProvider, { client }, createElement(Probe, { enabled: true })));

    expect(calls).toEqual([{ method: "getRun", params: { runId: "run-1" } }]);
    expect(state?.data).toEqual({ call: 1, params: { runId: "run-1" } });

    await root.unmount();
  });

  test("ignores stale responses when params change before the prior RPC settles", async () => {
    const { client, calls } = createDeferredRpcClient();
    let state: ReturnType<typeof useGatewayRpc<"getRun">> | undefined;

    function Probe(props: { runId: string }) {
      state = useGatewayRpc("getRun", { runId: props.runId });
      return null;
    }

    const root = await renderClient(
      createElement(SmithersGatewayProvider, { client }, createElement(Probe, { runId: "run-1" })),
    );

    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ method: "getRun", params: { runId: "run-1" } });

    await root.update(createElement(SmithersGatewayProvider, { client }, createElement(Probe, { runId: "run-2" })));

    expect(calls).toHaveLength(2);
    expect(calls[0].signal?.aborted).toBe(true);
    expect(calls[1]).toMatchObject({ method: "getRun", params: { runId: "run-2" } });

    await act(async () => {
      calls[1].resolve({ call: 2, params: { runId: "run-2" } });
      await flushEffects();
    });

    expect(state?.data).toEqual({ call: 2, params: { runId: "run-2" } });
    expect(state?.loading).toBe(false);

    await act(async () => {
      calls[0].resolve({ call: 1, params: { runId: "run-1" } });
      await flushEffects();
    });

    expect(state?.data).toEqual({ call: 2, params: { runId: "run-2" } });

    await root.unmount();
  });

  test("cancels in-flight RPC state updates when disabled", async () => {
    const { client, calls } = createDeferredRpcClient();
    let state: ReturnType<typeof useGatewayRpc<"getRun">> | undefined;

    function Probe(props: { enabled: boolean }) {
      state = useGatewayRpc("getRun", { runId: "run-1" }, { enabled: props.enabled });
      return null;
    }

    const root = await renderClient(
      createElement(SmithersGatewayProvider, { client }, createElement(Probe, { enabled: true })),
    );

    expect(calls).toHaveLength(1);
    expect(state?.loading).toBe(true);

    await root.update(createElement(SmithersGatewayProvider, { client }, createElement(Probe, { enabled: false })));

    expect(calls[0].signal?.aborted).toBe(true);
    expect(state?.loading).toBe(false);

    await act(async () => {
      calls[0].resolve({ call: 1, params: { runId: "run-1" } });
      await flushEffects();
    });

    expect(state?.data).toBeUndefined();
    expect(state?.error).toBeUndefined();
    expect(state?.loading).toBe(false);

    await root.unmount();
  });
});
