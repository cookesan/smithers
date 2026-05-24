import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { GATEWAY_SCOPE_VALUES } from "../src/auth/scopes.ts";

const REPO_ROOT = resolve(import.meta.dir, "../../..");

function gatewayScopesInDoc(path: string): string[] {
  const doc = readFileSync(resolve(REPO_ROOT, path), "utf8");
  return [...doc.matchAll(/`([a-z]+:[a-z]+)`/g)].map((match) => match[1]);
}

describe("Gateway scope documentation", () => {
  test("production hardening examples use only supported Gateway scopes", () => {
    const supported = new Set<string>(GATEWAY_SCOPE_VALUES);
    const scopes = gatewayScopesInDoc("docs/deployment/production-hardening.mdx");

    expect(scopes.length).toBeGreaterThan(0);
    expect(scopes.filter((scope) => !supported.has(scope))).toEqual([]);
  });
});
