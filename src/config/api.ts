import { strFromEnv } from "./env";

/**
 * Where the API lives, assembled from configuration rather than hard-coded.
 *
 * `API_PREFIX` and `API_VERSION` are read through `strFromEnv`, so a blank value falls back
 * instead of producing an empty path segment and a `//` in every route. Slashes are trimmed
 * so `API_PREFIX="/api/"` and `API_PREFIX="api"` both yield the same result — a config value
 * that differs only by punctuation should not change behaviour.
 *
 * Changing `API_VERSION` moves every endpoint at once. That is the point: a breaking change
 * ships as `v2` while `v1` keeps serving whatever mobile build is already in people's hands.
 */
const trim = (v: string) => v.replace(/^\/+|\/+$/g, "");

export const apiPrefix = (): string => trim(strFromEnv("API_PREFIX", "api"));
export const apiVersion = (): string => trim(strFromEnv("API_VERSION", "v1"));

/** The global route prefix, e.g. `api/v1`. Never leading or trailing slashes. */
export const apiBasePath = (): string => [apiPrefix(), apiVersion()].filter(Boolean).join("/");

/** Absolute path form, e.g. `/api/v1`. For logs, Swagger and health URLs. */
export const apiBaseUrl = (): string => `/${apiBasePath()}`;
