import { describe, expect, it } from "vitest";
import { round3, toDecimal } from "@/lib/server/serialize";

// `Math.Round(decimal, 3)` de .NET arrondit au pair (MidpointRounding.ToEven).
describe("round3", () => {
  it("conserve les montants déjà à 3 décimales", () => {
    expect(round3(0)).toBe(0);
    expect(round3(12.345)).toBe(12.345);
    expect(round3(1234.5)).toBe(1234.5);
  });

  it("arrondit les demi-valeurs au pair, comme .NET", () => {
    expect(round3(1.0005)).toBe(1);
    expect(round3(1.0015)).toBe(1.002);
    expect(round3(2.0005)).toBe(2);
    expect(round3(2.0015)).toBe(2.002);
    expect(round3(-1.0005)).toBe(-1);
    expect(round3(-1.0015)).toBe(-1.002);
  });

  it("arrondit au plus proche hors des demi-valeurs", () => {
    expect(round3(1.0004)).toBe(1);
    expect(round3(1.0006)).toBe(1.001);
    expect(round3(1.23449)).toBe(1.234);
    expect(round3(1.23451)).toBe(1.235);
  });

  it("neutralise le bruit binaire avant l'arrondi", () => {
    // 1.0005 * 1000 vaut 1000.4999999999999 en flottant.
    expect(round3(1.0005)).toBe(1);
    expect(round3(3 * 0.3335)).toBe(1);
  });

  it("gère les valeurs non finies sans produire NaN", () => {
    expect(round3(Number.NaN)).toBe(0);
    expect(round3(Number.POSITIVE_INFINITY)).toBe(0);
  });

  it("stocke toujours un Decimal128 à partir du même nombre", () => {
    expect(toDecimal(12.345).toString()).toBe("12.345");
    expect(toDecimal("12.345").toString()).toBe("12.345");
    expect(toDecimal(Number.NaN).toString()).toBe("0");
  });
});
