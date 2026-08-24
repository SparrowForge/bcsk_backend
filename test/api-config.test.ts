import { describe, it, expect, vi, afterEach } from "vitest";
import { apiPrefix, apiVersion, apiBasePath, apiBaseUrl } from "@/config/api";

/**
 * The API path is assembled from `API_PREFIX` and `API_VERSION` rather than hard-coded, so
 * changing `API_VERSION` relocates the whole surface at once — that is how a breaking change
 * ships as v2 while v1 keeps serving already-installed mobile builds.
 *
 * The cases below are the ones that would otherwise produce a subtly broken path: blanks
 * (which `??` would let through), and stray slashes from hand-edited .env files.
 */
describe("API path configuration", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("defaults to api/v1 when nothing is configured", () => {
    vi.stubEnv("API_PREFIX", "");
    vi.stubEnv("API_VERSION", "");
    expect(apiBasePath()).toBe("api/v1");
    expect(apiBaseUrl()).toBe("/api/v1");
  });

  it("uses configured values", () => {
    vi.stubEnv("API_PREFIX", "api");
    vi.stubEnv("API_VERSION", "v2");
    expect(apiBasePath()).toBe("api/v2");
    expect(apiBaseUrl()).toBe("/api/v2");
  });

  it.each([
    ["/api/", "/v1/", "api/v1"],
    ["api", "v1", "api/v1"],
    ["//gateway//", "//v3//", "gateway/v3"],
    ["  api  ", "  v1  ", "api/v1"],
  ])("normalises API_PREFIX=%o API_VERSION=%o to %o", (prefix, version, expected) => {
    // A config value that differs only by punctuation must not change behaviour.
    vi.stubEnv("API_PREFIX", prefix);
    vi.stubEnv("API_VERSION", version);
    expect(apiBasePath()).toBe(expected);
  });

  it("never emits a double slash or a trailing slash", () => {
    vi.stubEnv("API_PREFIX", "//api//");
    vi.stubEnv("API_VERSION", "//v9//");
    const url = apiBaseUrl();
    expect(url).toBe("/api/v9");
    expect(url).not.toMatch(/\/\//);
    expect(url.endsWith("/")).toBe(false);
  });

  it("treats a blank value as absent rather than an empty segment", () => {
    // The trap this guards: `process.env.X ?? "api"` would keep "" and yield "//v1".
    vi.stubEnv("API_PREFIX", "   ");
    vi.stubEnv("API_VERSION", "v1");
    expect(apiPrefix()).toBe("api");
    expect(apiBasePath()).toBe("api/v1");
  });

  it("exposes prefix and version independently for Swagger and logs", () => {
    vi.stubEnv("API_PREFIX", "api");
    vi.stubEnv("API_VERSION", "v4");
    expect(apiPrefix()).toBe("api");
    expect(apiVersion()).toBe("v4");
  });
});
