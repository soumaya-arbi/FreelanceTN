import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ActionError } from "@/lib/server/errors";
import { completeJson } from "@/lib/server/ai/provider";

describe("Next.js to FastAPI transport", () => {
  beforeEach(() => {
    vi.stubEnv("AI_SERVICE_URL", "");
    vi.stubEnv("AI_SERVICE_TOKEN", "");
    vi.stubEnv("AI_MAX_TOKENS", "2500");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("fails clearly without an internal service configuration and makes no request", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(completeJson([])).rejects.toThrow(/AI_SERVICE_URL/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("forwards the unchanged prompt with the server token and preserves the response contract", async () => {
    vi.stubEnv("AI_SERVICE_URL", "http://127.0.0.1:8100");
    vi.stubEnv("AI_SERVICE_TOKEN", "unit-test-internal-token-with-over-32-chars");
    const fetchMock = vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ content: "{\"ok\":true}", model: "@cf/meta/test-model" }),
      { status: 200 },
    ));
    vi.stubGlobal("fetch", fetchMock);
    await expect(completeJson([{ role: "user", content: "brief" }])).resolves.toBe('{"ok":true}');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe("http://127.0.0.1:8100/v1/generate-json");
    expect(fetchMock.mock.calls[0][1]?.headers).toMatchObject({ Authorization: "Bearer unit-test-internal-token-with-over-32-chars" });
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toMatchObject({
      messages: [{ role: "user", content: "brief" }],
      temperature: 0.4,
      max_tokens: 2500,
    });
  });

  it("maps Workers AI quota responses to a safe actionable error", async () => {
    vi.stubEnv("AI_SERVICE_URL", "http://127.0.0.1:8100");
    vi.stubEnv("AI_SERVICE_TOKEN", "unit-test-internal-token-with-over-32-chars");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ detail: { code: "quota_exhausted", message: "private provider detail" } }),
      { status: 503 },
    )));
    await expect(completeJson([])).rejects.toThrow(/quota/i);
    await expect(completeJson([])).rejects.not.toThrow(/private provider detail/);
  });

  it("rejects malformed successful responses", async () => {
    vi.stubEnv("AI_SERVICE_URL", "http://127.0.0.1:8100");
    vi.stubEnv("AI_SERVICE_TOKEN", "unit-test-internal-token-with-over-32-chars");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 200 })));
    await expect(completeJson([])).rejects.toBeInstanceOf(ActionError);
  });
});
