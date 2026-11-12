import { describe, expect, it, vi } from "vitest";
import { createSingleFlight } from "@/lib/singleFlight";

describe("createSingleFlight", () => {
  it("bloque le second clic tant que le premier n'est pas terminé", () => {
    const flight = createSingleFlight();

    expect(flight.begin()).toBe(true);
    expect(flight.begin()).toBe(false);
    expect(flight.begin()).toBe(false);
    expect(flight.isRunning()).toBe(true);
  });

  it("rouvre une nouvelle tentative après la fin de la précédente", () => {
    const flight = createSingleFlight();

    expect(flight.begin()).toBe(true);
    flight.end();

    expect(flight.isRunning()).toBe(false);
    expect(flight.begin()).toBe(true);
  });

  it("n'exécute qu'une seule action sur deux clics simultanés", async () => {
    const flight = createSingleFlight();
    const task = vi.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      return "ok";
    });

    const action = async () => {
      if (!flight.begin()) return "bloqué";
      try {
        return await task();
      } finally {
        flight.end();
      }
    };

    const results = await Promise.all([action(), action()]);

    expect(results.filter((result) => result === "ok")).toHaveLength(1);
    expect(results.filter((result) => result === "bloqué")).toHaveLength(1);
    expect(task).toHaveBeenCalledTimes(1);
  });

  it("reste utilisable après une action en échec", async () => {
    const flight = createSingleFlight();

    const failing = async () => {
      if (!flight.begin()) return "bloqué";
      try {
        throw new Error("échec");
      } finally {
        flight.end();
      }
    };

    await expect(failing()).rejects.toThrow("échec");
    expect(flight.isRunning()).toBe(false);
    expect(flight.begin()).toBe(true);
  });
});
