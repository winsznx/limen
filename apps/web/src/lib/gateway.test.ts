import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { deploymentConfig } from "./config.js";
import { proverHealth, proverJobs, proverMetrics } from "./gateway.js";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("server-side deployment configuration", () => {
  it("uses a public RPC only when a credentialed endpoint is absent", () => {
    vi.stubEnv("STARKNET_RPC_URL", "");
    vi.stubEnv("LIMEN_NETWORK", "sepolia");

    const config = deploymentConfig();

    expect(config.network.network).toBe("sepolia");
    expect(config.rpcUrl).toBe("https://rpc.starknet.lava.build");
  });

  it("rejects malformed deployment addresses rather than rendering them", () => {
    vi.stubEnv("LIMEN_ANONYMIZER_ADDRESS", "not-an-address");
    vi.stubEnv("LIMEN_CAPITAL_GATE_ADDRESS", "0x0");

    const config = deploymentConfig();

    expect(config.anonymizer).toBeNull();
    expect(config.capitalGate).toBeNull();
  });
});

describe("prover gateway reads", () => {
  it("treats an unhealthy gateway response as useful health data", async () => {
    vi.stubEnv("LIMEN_GATEWAY_URL", "https://gateway.example/");
    const fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          healthy: false,
          kind: "limen-self-hosted",
          name: "Limen Prover",
          checkedAt: "2026-08-28T00:00:00.000Z",
        }),
        { status: 503 }
      )
    );
    vi.stubGlobal("fetch", fetch);

    await expect(proverHealth()).resolves.toMatchObject({ healthy: false });
    expect(fetch).toHaveBeenCalledWith(
      "https://gateway.example/health",
      expect.objectContaining({ headers: {} })
    );
  });

  it("never calls protected gateway endpoints without the server token", async () => {
    vi.stubEnv("LIMEN_GATEWAY_URL", "https://gateway.example");
    vi.stubEnv("LIMEN_GATEWAY_TOKEN", "");
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);

    await expect(proverMetrics()).resolves.toBeNull();
    await expect(proverJobs()).resolves.toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("uses the server-only token for protected gateway reads", async () => {
    vi.stubEnv("LIMEN_GATEWAY_URL", "https://gateway.example");
    vi.stubEnv("LIMEN_GATEWAY_TOKEN", "gateway-token");
    const fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ jobs: [] }), { status: 200 })
    );
    vi.stubGlobal("fetch", fetch);

    await expect(proverJobs()).resolves.toEqual([]);
    expect(fetch).toHaveBeenCalledWith(
      "https://gateway.example/jobs",
      expect.objectContaining({ headers: { authorization: "Bearer gateway-token" } })
    );
  });
});
