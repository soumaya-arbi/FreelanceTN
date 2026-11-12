import { describe, expect, it } from "vitest";
import { freelancerClientProfilePath } from "@/lib/navigation";

describe("freelancerClientProfilePath", () => {
  it("utilise l'identifiant réel du client comme clé de routage", () => {
    expect(freelancerClientProfilePath("6ad933e3d523034152a802dc")).toBe(
      "/freelancer/clients/6ad933e3d523034152a802dc",
    );
  });

  it("n'utilise jamais le nom du client et encode les caractères spéciaux", () => {
    const path = freelancerClientProfilePath("client/id avec espaces");
    expect(path).toBe("/freelancer/clients/client%2Fid%20avec%20espaces");
    expect(path).not.toContain("hello hello");
  });
});
