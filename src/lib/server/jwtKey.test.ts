import { describe, expect, it } from "vitest";
import { DEV_JWT_KEY, MIN_JWT_KEY_LENGTH, resolveJwtKey } from "@/lib/server/jwtKey";

const PROD_KEY = "k9Q2mF7vX1pR4tY8sL3nB6cD0hJ5gA2e";

describe("resolveJwtKey", () => {
  it("utilise la clé de développement quand aucune clé n'est configurée en dev", () => {
    expect(resolveJwtKey({ NODE_ENV: "development" })).toBe(DEV_JWT_KEY);
  });

  it("utilise la clé explicite fournie en développement", () => {
    expect(resolveJwtKey({ NODE_ENV: "development", JWT_KEY: PROD_KEY })).toBe(PROD_KEY);
  });

  it("accepte Jwt__Key (convention .NET) comme alias", () => {
    expect(resolveJwtKey({ NODE_ENV: "production", Jwt__Key: PROD_KEY })).toBe(PROD_KEY);
  });

  it("refuse une production sans clé explicite", () => {
    expect(() => resolveJwtKey({ NODE_ENV: "production" })).toThrow(/JWT_KEY est obligatoire/);
  });

  it("interdit formellement la clé de développement en production", () => {
    expect(() => resolveJwtKey({ NODE_ENV: "production", JWT_KEY: DEV_JWT_KEY })).toThrow(
      /clé JWT de développement est interdite/,
    );
  });

  it("refuse une clé trop courte en production", () => {
    expect(() => resolveJwtKey({ NODE_ENV: "production", JWT_KEY: "trop-court" })).toThrow(
      new RegExp(`${MIN_JWT_KEY_LENGTH} caractères`),
    );
  });
});
