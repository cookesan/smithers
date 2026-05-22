import type { GatewayEventFrame } from "./GatewayEventFrame.ts";
import type { GatewayResponseFrame } from "./GatewayResponseFrame.ts";

export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isGatewayResponseFrame(value: unknown): value is GatewayResponseFrame {
  if (!isObject(value)) {
    return false;
  }
  if (value.type !== "res" || typeof value.id !== "string" || typeof value.ok !== "boolean") {
    return false;
  }
  if (value.ok === true) {
    return "payload" in value;
  }
  return isObject(value.error) &&
    typeof value.error.code === "string" &&
    typeof value.error.message === "string";
}

export function isGatewayEventFrame(value: unknown): value is GatewayEventFrame {
  return isObject(value) &&
    value.type === "event" &&
    typeof value.event === "string" &&
    typeof value.seq === "number" &&
    typeof value.stateVersion === "number";
}
