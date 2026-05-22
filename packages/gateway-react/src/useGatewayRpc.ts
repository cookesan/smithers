import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { GatewayRpcMethod } from "@smithers-orchestrator/gateway/rpc";
import type { GatewayRpcParams, GatewayRpcPayload } from "@smithers-orchestrator/gateway-client";
import { useSmithersGateway } from "./useSmithersGateway.ts";
import type { GatewayAsyncState } from "./GatewayAsyncState.ts";

export function useGatewayRpc<Method extends GatewayRpcMethod>(
  method: Method,
  params: GatewayRpcParams<Method>,
  options: { enabled?: boolean; deps?: readonly unknown[] } = {},
): GatewayAsyncState<GatewayRpcPayload<Method>> {
  const client = useSmithersGateway();
  const enabled = options.enabled ?? true;
  const paramsKey = useMemo(() => JSON.stringify(params ?? {}), [params]);
  const deps = useMemo(() => options.deps ?? [paramsKey], [options.deps, paramsKey]);
  const paramsRef = useRef(params);
  const activeAbortRef = useRef<AbortController | undefined>(undefined);
  const mountedRef = useRef(true);
  const requestIdRef = useRef(0);
  const previousEffectRef = useRef<{
    client: typeof client;
    enabled: boolean;
    method: Method;
    deps: readonly unknown[];
  } | undefined>(undefined);
  paramsRef.current = params;
  const [data, setData] = useState<GatewayRpcPayload<Method>>();
  const [error, setError] = useState<Error>();
  const [loading, setLoading] = useState(enabled);

  const cancelActiveRequest = useCallback(() => {
    requestIdRef.current += 1;
    activeAbortRef.current?.abort();
    activeAbortRef.current = undefined;
  }, []);

  const refetch = useCallback(async () => {
    if (!enabled) {
      return;
    }
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    activeAbortRef.current?.abort();
    const abort = new AbortController();
    activeAbortRef.current = abort;
    setLoading(true);
    setError(undefined);
    try {
      const result = await client.rpc(method, paramsRef.current, { signal: abort.signal });
      if (mountedRef.current && requestIdRef.current === requestId && !abort.signal.aborted) {
        setData(result);
      }
    } catch (cause) {
      if (mountedRef.current && requestIdRef.current === requestId && !abort.signal.aborted) {
        setError(cause instanceof Error ? cause : new Error(String(cause)));
      }
    } finally {
      if (requestIdRef.current === requestId) {
        activeAbortRef.current = undefined;
        if (mountedRef.current) {
          setLoading(false);
        }
      }
    }
  }, [client, enabled, method]);

  useEffect(() => () => {
    mountedRef.current = false;
    cancelActiveRequest();
  }, [cancelActiveRequest]);

  useEffect(() => {
    const previous = previousEffectRef.current;
    const changed = !previous ||
      previous.client !== client ||
      previous.enabled !== enabled ||
      previous.method !== method ||
      previous.deps.length !== deps.length ||
      deps.some((dep, index) => !Object.is(dep, previous.deps[index]));
    previousEffectRef.current = { client, enabled, method, deps: [...deps] };
    if (changed) {
      if (!enabled) {
        cancelActiveRequest();
        setLoading(false);
        return;
      }
      void refetch();
    }
  }, [cancelActiveRequest, client, deps, enabled, method, refetch]);

  return { data, error, loading, refetch };
}
