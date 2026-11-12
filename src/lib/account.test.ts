import { afterEach, describe, expect, it, vi } from "vitest";
import * as accountActions from "@/lib/actions/account";
import { accountApi } from "@/lib/api";

// Profil et préférences passent par des Server Actions ; l'équipe et la
// sécurité restent sur les endpoints .NET et continuent d'utiliser `fetch`.
const ok = (data: unknown) => ({ ok: true as const, data });

// Payloads simulés : ce sont les réponses réelles du backend qui sont mappées.
const jsonResponse = (payload: unknown) =>
  ({
    ok: true,
    status: 200,
    text: async () => JSON.stringify(payload),
  }) as unknown as Response;

const stubFetch = (payload: unknown) => {
  const fetchMock = vi.fn(async () => jsonResponse(payload));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe("mapping du profil client", () => {
  it("conserve les champs professionnels et la complétion", async () => {
    vi.mocked(accountActions.getClientProfile).mockResolvedValue(
      ok({
        id: "user-1",
        email: "client@exemple.tn",
        emailVerified: true,
        hasPassword: true,
        role: "Client",
        firstName: "Sami",
        lastName: "Ben Ali",
        companyName: "Atlas Studio",
        companyLogo: "/api/uploads/logo/a.webp",
        coverImage: "/api/uploads/cover/b.webp",
        industry: "Technology & software",
        governorate: "Tunis",
        profileCompletion: 71,
        missingFields: ["Adresse professionnelle"],
        avatarSource: "upload",
      }),
    );

    const profile = await accountApi.getProfile();

    expect(profile.role).toBe("client");
    expect(profile.companyName).toBe("Atlas Studio");
    expect(profile.governorate).toBe("Tunis");
    expect(profile.profileCompletion).toBe(71);
    expect(profile.missingFields).toEqual(["Adresse professionnelle"]);
    expect(profile.avatarSource).toBe("upload");
  });

  it("retombe sur « initials » pour une source d'avatar inconnue", async () => {
    vi.mocked(accountActions.getClientProfile).mockResolvedValue(
      ok({ id: "user-2", avatarSource: "ai-generated" }),
    );
    const profile = await accountApi.getProfile();
    expect(profile.avatarSource).toBe("initials");
  });
});

describe("mapping de l'équipe", () => {
  it("normalise les rôles et statuts connus", async () => {
    stubFetch([
      { id: "m1", email: "a@exemple.tn", role: "Admin", status: "Active", canManage: true },
      { id: "m2", email: "b@exemple.tn", role: "Viewer", status: "Pending" },
    ]);

    const team = await accountApi.listTeam();

    expect(team).toHaveLength(2);
    expect(team[0].role).toBe("Admin");
    expect(team[0].status).toBe("Active");
    expect(team[0].canManage).toBe(true);
    expect(team[1].status).toBe("Pending");
    expect(team[1].acceptedAt).toBeNull();
  });

  it("refuse les valeurs inconnues en repli sûr", async () => {
    stubFetch([{ id: "m3", email: "c@exemple.tn", role: "SuperAdmin", status: "Weird" }]);
    const [member] = await accountApi.listTeam();
    expect(member.role).toBe("Member");
    expect(member.status).toBe("Pending");
  });
});

describe("préférences", () => {
  it("force la devise TND et un format de date valide", async () => {
    vi.mocked(accountActions.getUserPreferences).mockResolvedValue(
      ok({
        language: "en",
        currency: "USD",
        theme: "dark",
        timezone: "Europe/Paris",
        dateFormat: "MM-DD",
        thousandsSeparator: false,
      }),
    );

    const preferences = await accountApi.getPreferences();

    expect(preferences.currency).toBe("TND");
    expect(preferences.dateFormat).toBe("DD/MM/YYYY");
    expect(preferences.language).toBe("en");
    expect(preferences.theme).toBe("dark");
    expect(preferences.thousandsSeparator).toBe(false);
  });
});

describe("sécurité", () => {
  it("n'annonce jamais 2FA disponible sans fournisseur", async () => {
    stubFetch({
      email: "client@exemple.tn",
      emailVerified: false,
      hasPassword: true,
      twoFactorAvailable: false,
      twoFactorMessage: "Bientôt disponible.",
      sessions: [{ id: "s1", current: true, rememberMe: true }],
    });

    const security = await accountApi.getSecurity();

    expect(security.twoFactorAvailable).toBe(false);
    expect(security.sessions[0].current).toBe(true);
    expect(security.sessions[0].rememberMe).toBe(true);
  });
});
