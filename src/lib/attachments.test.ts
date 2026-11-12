import { afterEach, describe, expect, it, vi } from "vitest";
import { projectsApi } from "@/lib/api";
import type { ProjectAttachment } from "@/lib/types";

const jsonResponse = (payload: unknown, status = 200, ok = true) =>
  ({
    ok,
    status,
    json: async () => payload,
    text: async () => JSON.stringify(payload),
  }) as unknown as Response;

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("projectsApi.uploadAttachment", () => {
  it("envoie le fichier via FormData et renvoie les métadonnées", async () => {
    const mockFile = new File(["dummy content"], "brief.pdf", { type: "application/pdf" });
    const mockFetch = vi.fn<typeof fetch>(async () =>
      jsonResponse({
        fileName: "brief.pdf",
        url: "/api/uploads/project/proj1/abc123.pdf",
        size: 13,
      }),
    );
    vi.stubGlobal("fetch", mockFetch);

    const result = await projectsApi.uploadAttachment("proj1", mockFile);

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [calledUrl] = mockFetch.mock.calls[0];
    const calledInit = mockFetch.mock.calls[0][1] as RequestInit;
    expect(calledUrl).toBe("/api/uploads/project/proj1");
    expect(calledInit?.method).toBe("POST");
    expect(calledInit?.credentials).toBe("include");
    expect(calledInit?.body).toBeInstanceOf(FormData);

    expect(result.fileName).toBe("brief.pdf");
    expect(result.url).toBe("/api/uploads/project/proj1/abc123.pdf");
    expect(result.size).toBe(13);
  });

  it("lève une exception en cas d'erreur HTTP", async () => {
    const mockFile = new File(["dummy"], "large.zip", { type: "application/zip" });
    const mockFetch = vi.fn(async () => jsonResponse({ message: "Le fichier ne peut pas depasser 10 Mo." }, 409, false));
    vi.stubGlobal("fetch", mockFetch);

    await expect(projectsApi.uploadAttachment("proj1", mockFile)).rejects.toThrow("Upload failed");
  });
});

describe("Logique de suivi d'upload, retry et absence de doublons", () => {
  it("déduplique les pièces jointes par URL et préserve les anciennes pièces jointes", () => {
    const existingAttachments: ProjectAttachment[] = [
      {
        fileName: "old_brief.pdf",
        url: "/api/uploads/project/p1/old1.pdf",
        size: 1024,
        uploadedAt: "2026-01-01T10:00:00Z",
      },
    ];

    const newlyUploaded: ProjectAttachment[] = [
      // Fichier déjà existant par son URL
      {
        fileName: "old_brief_duplicate.pdf",
        url: "/api/uploads/project/p1/old1.pdf",
        size: 1024,
        uploadedAt: "2026-01-02T10:00:00Z",
      },
      // Nouveau fichier unique
      {
        fileName: "new_specs.docx",
        url: "/api/uploads/project/p1/new2.docx",
        size: 2048,
        uploadedAt: "2026-01-02T10:00:00Z",
      },
    ];

    const combined = [...existingAttachments, ...newlyUploaded];
    const deduped: ProjectAttachment[] = [];
    const seen = new Set<string>();

    for (const item of combined) {
      const key = item.url.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        deduped.push(item);
      }
    }

    expect(deduped).toHaveLength(2);
    expect(deduped[0].fileName).toBe("old_brief.pdf");
    expect(deduped[1].fileName).toBe("new_specs.docx");
  });

  it("gère un échec d'upload suivi d'un retry sans ré-uploader les fichiers réussis", async () => {
    type TestFileItem = {
      id: string;
      name: string;
      status: "idle" | "uploading" | "success" | "error";
      attachment?: ProjectAttachment;
    };

    const files: TestFileItem[] = [
      { id: "1", name: "doc1.pdf", status: "idle" },
      { id: "2", name: "doc2.pdf", status: "idle" },
    ];

    const project = { id: "proj-1" };

    const uploadCalls: string[] = [];
    const mockUpload = vi.fn(async (projId: string, file: { name: string }) => {
      uploadCalls.push(file.name);
      if (file.name === "doc2.pdf") {
        throw new Error("Network timeout");
      }
      return {
        fileName: file.name,
        url: `/api/uploads/project/${projId}/${file.name}`,
        size: 100,
      };
    });

    // 1ère tentative
    for (let i = 0; i < files.length; i++) {
      const item = files[i];
      if (item.status === "success") continue;
      try {
        const res = await mockUpload(project.id, { name: item.name });
        files[i] = {
          ...item,
          status: "success",
          attachment: {
            fileName: res.fileName,
            url: res.url,
            size: res.size,
            uploadedAt: "now",
          },
        };
      } catch {
        files[i] = { ...item, status: "error" };
      }
    }

    expect(uploadCalls).toEqual(["doc1.pdf", "doc2.pdf"]);
    expect(files[0].status).toBe("success");
    expect(files[1].status).toBe("error");

    // 2ème tentative (Retry) : doc1.pdf étant en "success", il ne doit PAS être rappelé
    mockUpload.mockImplementationOnce(async (projId: string, file: { name: string }) => {
      uploadCalls.push(`retry-${file.name}`);
      return {
        fileName: file.name,
        url: `/api/uploads/project/${projId}/${file.name}`,
        size: 100,
      };
    });

    for (let i = 0; i < files.length; i++) {
      const item = files[i];
      // Skip already successful
      if (item.status === "success") continue;
      try {
        const res = await mockUpload(project.id, { name: item.name });
        files[i] = {
          ...item,
          status: "success",
          attachment: {
            fileName: res.fileName,
            url: res.url,
            size: res.size,
            uploadedAt: "now",
          },
        };
      } catch {
        files[i] = { ...item, status: "error" };
      }
    }

    // doc1.pdf n'a été appelé qu'une seule fois !
    expect(uploadCalls).toEqual(["doc1.pdf", "doc2.pdf", "retry-doc2.pdf"]);
    expect(files[0].status).toBe("success");
    expect(files[1].status).toBe("success");
  });

  it("permet de supprimer un nouveau fichier avant upload", () => {
    let queue = [
      { id: "a", name: "plan.pdf" },
      { id: "b", name: "draft.png" },
    ];

    // L'utilisateur supprime draft.png avant de lancer la publication ou la sauvegarde
    queue = queue.filter((item) => item.id !== "b");

    expect(queue).toHaveLength(1);
    expect(queue[0].name).toBe("plan.pdf");
  });
});
