"use client";

import { useEffect, useState } from "react";
import { Icon } from "@/components/ui/Icon";
import { Button } from "@/components/ui/Button";
import { FormField } from "@/components/ui/Form";
import { AppShell } from "@/components/layout/AppShell";
import { ImageCropper, validateImageFile, type CropTarget } from "@/components/views/account/ImageCropper";
import type { Page } from "@/lib/types";
import { useUser } from "@/context/UserContext";
import { ApiError, accountApi } from "@/lib/api";
import { AvatarStudio } from "@/components/views/account/AvatarStudio";
import { AvatarBadge } from "@/components/views/account/AvatarBadge";
import { parseAvatarConfig } from "@/lib/avatar";

function ProfileEditor({ go, notify }: { go: (p: Page) => void; notify: (x: string) => void }) {
  const { authUser, updateProfile, uploadAvatar, refreshUser } = useUser();
  const [firstName, setFirstName] = useState(authUser?.firstName ?? "");
  const [lastName, setLastName] = useState(authUser?.lastName ?? "");
  const [title, setTitle] = useState(authUser?.title ?? "");
  const [location, setLocation] = useState(authUser?.location ?? "");
  const [photo, setPhoto] = useState(authUser?.avatar ?? "");
  const [photoUrl, setPhotoUrl] = useState(authUser?.avatar ?? "");
  const [cover, setCover] = useState(authUser?.coverImage ?? "");
  const [avatarConfig, setAvatarConfig] = useState(authUser?.avatarConfig ?? "");
  const [coverBusy, setCoverBusy] = useState(false);
  const [avatarStudioOpen, setAvatarStudioOpen] = useState(false);
  const [photoEditorOpen, setPhotoEditorOpen] = useState(false);
  const [cropTarget, setCropTarget] = useState<CropTarget | null>(null);
  const [cropKind, setCropKind] = useState<"avatar" | "cover">("avatar");
  const [photoError, setPhotoError] = useState("");
  const [photoBusy, setPhotoBusy] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!authUser) return;
    setFirstName(authUser.firstName ?? "");
    setLastName(authUser.lastName ?? "");
    setTitle(authUser.title ?? "");
    setLocation(authUser.location ?? "");
    setPhoto(authUser.avatar ?? "");
    setPhotoUrl(authUser.avatar ?? "");
    setCover(authUser.coverImage ?? "");
    setAvatarConfig(authUser.avatarConfig ?? "");
  }, [authUser]);

  const isStoredAvatar = (value: string) => value.startsWith("/api/uploads/avatar/") || value.startsWith("/");
  const isHttpUrl = (value: string) => /^https?:\/\//i.test(value);

  const applyPhoto = async () => {
    const value = photoUrl.trim();
    if (value && !isHttpUrl(value)) {
      setPhotoError("Use a valid http(s) image URL.");
      return;
    }
    if (value.length > 500) {
      setPhotoError("The image URL cannot exceed 500 characters.");
      return;
    }
    setPhotoBusy(true);
    setPhotoError("");
    try {
      // Persist photo URL independently; avatarConfig remains unchanged.
      const updated = await updateProfile({ avatar: value });
      setPhoto(updated.avatar ?? value);
      setPhotoUrl(updated.avatar ?? value);
      setPhotoEditorOpen(false);
      notify("Profile photo updated");
    } catch (err) {
      setPhotoError(err instanceof ApiError ? err.message : "Could not update the photo");
    } finally {
      setPhotoBusy(false);
    }
  };

  const uploadPhoto = async (file?: File) => {
    if (!file) return;
    if (!/^image\/(jpeg|png|webp)$/i.test(file.type)) {
      setPhotoError("Formats accepted: JPG, PNG or WebP.");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setPhotoError("The image cannot exceed 5 MB.");
      return;
    }
    setPhotoBusy(true);
    setPhotoError("");
    try {
      // Upload endpoint saves the real photo; it must not delete avatarConfig.
      const user = await uploadAvatar(file);
      setPhoto(user.avatar ?? "");
      setPhotoUrl(user.avatar ?? "");
      setAvatarConfig(user.avatarConfig ?? avatarConfig);
      setPhotoEditorOpen(false);
      notify("Profile photo updated");
    } catch (err) {
      setPhotoError(err instanceof ApiError ? err.message : "Could not upload the photo");
    } finally {
      setPhotoBusy(false);
    }
  };

  const uploadCover = async (file?: File) => {
    if (!file) return;
    if (!/^image\/(jpeg|png|webp)$/i.test(file.type)) {
      notify("Formats accepted: JPG, PNG or WebP.");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      notify("The image cannot exceed 5 MB.");
      return;
    }
    setCoverBusy(true);
    try {
      const { url } = await accountApi.uploadCover(file);
      setCover(url);
      notify("Cover image updated");
    } catch (err) {
      notify(err instanceof ApiError ? err.message : "Could not upload the cover image");
    } finally {
      setCoverBusy(false);
    }
  };

  const removeCover = async () => {
    setCoverBusy(true);
    try {
      await accountApi.deleteCover();
      setCover("");
      notify("Cover image removed");
    } catch (err) {
      notify(err instanceof ApiError ? err.message : "Could not remove the cover image");
    } finally {
      setCoverBusy(false);
    }
  };

  const removePhoto = async () => {
    // Clear the real photo only; keep the personalized avatar config.
    setPhotoBusy(true);
    setPhotoError("");
    try {
      await accountApi.deleteAvatar();
      setPhoto("");
      setPhotoUrl("");
      await refreshUser();
      notify("Profile photo removed");
    } catch (err) {
      setPhotoError(err instanceof ApiError ? err.message : "Could not remove the photo");
    } finally {
      setPhotoBusy(false);
    }
  };

  const openCrop = (kind: "avatar" | "cover", file: File) => {
    const issue = validateImageFile(file, 5);
    if (issue) {
      setPhotoError(issue);
      return;
    }
    setPhotoError("");
    setCropKind(kind);
    setCropTarget({
      file,
      aspect: kind === "cover" ? 16 / 5 : 1,
      outputWidth: kind === "cover" ? 1600 : 512,
      outputHeight: kind === "cover" ? 500 : 512,
      title: kind === "avatar" ? "Recadrer la photo" : "Recadrer la couverture",
    });
  };

  const handleCropSave = async (file: File) => {
    setCropTarget(null);
    if (cropKind === "avatar") await uploadPhoto(file);
    else await uploadCover(file);
  };

  const save = async () => {
    if (photo.trim() && !isStoredAvatar(photo.trim()) && !isHttpUrl(photo.trim())) {
      setPhotoError("Use a valid http(s) image URL or upload a file.");
      notify("Use a valid http(s) image URL or upload a file.");
      return;
    }
    if (photo.trim().length > 500) {
      setPhotoError("The image URL cannot exceed 500 characters.");
      notify("The image URL cannot exceed 500 characters.");
      return;
    }
    if (!firstName.trim() || !lastName.trim()) {
      notify("First name and last name are required.");
      return;
    }
    setSaving(true);
    try {
      // Save profile fields and real photo; avatarConfig is preserved.
      const updated = await updateProfile({ firstName, lastName, title, location, avatar: photo.trim() });
      setPhoto(updated.avatar ?? photo.trim());
      setAvatarConfig(updated.avatarConfig ?? avatarConfig);
      setPhotoError("");
      notify("Profile saved");
    } catch (err) {
      notify(err instanceof ApiError ? err.message : "Could not save the profile");
    } finally {
      setSaving(false);
    }
  };

  const studioInitial = parseAvatarConfig(avatarConfig) ?? undefined;

  return (
    <AppShell page="profile-edit" go={go} notify={notify}>
      <main className="workspace profile-editor-page">
        <div className="workspace-title">
          <div>
            <p>PUBLIC PRESENCE</p>
            <h1>Edit your professional profile</h1>
            <span>Clients discover and evaluate you through this profile.</span>
          </div>
          <div className="title-actions">
            <Button variant="secondary" onClick={() => go("profile")}>Preview profile</Button>
            <Button onClick={save} disabled={saving}>{saving ? "Saving…" : "Save changes"}</Button>
          </div>
        </div>

        <div className="profile-editor-layout">
          <nav className="editor-nav">
            <button className="active">
              <span>Basics</span>
              {firstName.trim() && lastName.trim() ? <Icon name="check" size={14} /> : <Icon name="chevron" size={14} />}
            </button>
            <button onClick={() => go("portfolio")}><span>Portfolio &amp; CV</span><Icon name="chevron" size={14} /></button>
          </nav>

          <section className="dash-card editor-form">
            <div className="cover-editor" style={{ marginBottom: 16 }}>
              <div className="cover-preview">{cover ? <img src={cover} alt="Cover image" /> : <span>No cover image</span>}</div>
              <div className="cover-actions">
                <Button
                  variant="secondary"
                  onClick={() => {
                    const input = document.createElement("input");
                    input.type = "file";
                    input.accept = "image/jpeg,image/png,image/webp";
                    input.onchange = (e: any) => {
                      const f = e.target.files?.[0];
                      if (f) openCrop("cover", f);
                    };
                    input.click();
                  }}
                  disabled={coverBusy}
                >
                  {cover ? "Replace cover" : "Upload cover"}
                </Button>
                {cover && <button type="button" className="ghost-danger" onClick={removeCover} disabled={coverBusy}>Remove</button>}
              </div>
            </div>

            <div className="profile-photo-edit profile-photo-edit-stacked">
              <AvatarBadge
                url={photo || undefined}
                firstName={authUser?.firstName ?? firstName}
                lastName={authUser?.lastName ?? lastName}
                preset={authUser?.avatarPreset}
                color={authUser?.avatarColor}
                size={120}
                source={authUser?.avatarSource}
                avatarConfig={avatarConfig || authUser?.avatarConfig}
              />
              <div>
                <div className="settings-actions" style={{ marginBottom: 8 }}>
                  <Button variant="secondary" onClick={() => { setPhotoUrl(photo); setPhotoError(""); setPhotoEditorOpen(true); }}>Change photo</Button>
                  <Button variant="secondary" onClick={() => setAvatarStudioOpen(true)}>
                    {avatarConfig ? "Modifier l'avatar" : "Créer mon avatar"}
                  </Button>
                  {photo && <button type="button" className="ghost-danger" onClick={() => void removePhoto()} disabled={photoBusy}>Remove photo</button>}
                </div>
                <small>Votre photo réelle reste principale. L'avatar personnalisé s'affiche en complément (petit badge). JPG, PNG ou WebP (max 5 Mo).</small>
                {photoEditorOpen && (
                  <div style={{ marginTop: 10 }}>
                    <label className="editor-field">
                      Upload from your computer
                      <input
                        type="file"
                        accept="image/jpeg,image/png,image/webp"
                        disabled={photoBusy}
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          if (f) openCrop("avatar", f);
                        }}
                      />
                    </label>
                    <label className="editor-field">
                      Or paste an image URL
                      <input
                        value={photoUrl}
                        onChange={(e) => { setPhotoUrl(e.target.value); setPhotoError(""); }}
                        placeholder="https://example.com/photo.jpg"
                        maxLength={500}
                      />
                    </label>
                    <div className="title-actions">
                      <Button onClick={() => void applyPhoto()} disabled={photoBusy}>Use URL</Button>
                      <Button variant="secondary" onClick={() => { setPhotoEditorOpen(false); setPhotoError(""); }} disabled={photoBusy}>Cancel</Button>
                    </div>
                    {photoBusy && <small>Uploading…</small>}
                  </div>
                )}
                {photoError && <small className="form-error" role="alert">{photoError}</small>}
              </div>
            </div>

            <div className="form-split">
              <FormField label="First name"><input value={firstName} onChange={(e) => setFirstName(e.target.value)} /></FormField>
              <FormField label="Last name"><input value={lastName} onChange={(e) => setLastName(e.target.value)} /></FormField>
            </div>
            <FormField label="Professional title"><input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Full-stack developer" /></FormField>
            <FormField label="Location"><input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="e.g. Tunis, Tunisia" /></FormField>
            <p className="task-empty">Your biography, skills, experience, education, languages and rates are managed from the <button className="text-btn" onClick={() => go("portfolio")}>Portfolio &amp; CV</button> page.</p>

            {avatarStudioOpen && (
              <div className="modal-backdrop" onClick={() => setAvatarStudioOpen(false)}>
                <div className="auth-modal avatar-studio-popup" style={{ maxWidth: 920, width: "94vw" }} onClick={(e) => e.stopPropagation()}>
                  <button className="modal-close" onClick={() => setAvatarStudioOpen(false)} aria-label="Fermer"><Icon name="close" /></button>
                  <h2>Avatar Studio</h2>
                  <p className="muted" style={{ marginTop: -4, marginBottom: 12 }}>La photo réelle reste votre photo principale. L'avatar personnalisé s'affiche en complément.</p>
                  <AvatarStudio
                    initial={studioInitial}
                    onCancel={() => setAvatarStudioOpen(false)}
                    onSave={async (config) => {
                      // Save avatar config only. Never overwrite the real profile photo URL.
                      const updated = await updateProfile({
                        avatarConfig: JSON.stringify(config),
                        avatarSource: "generated",
                      });
                      setAvatarConfig(updated.avatarConfig ?? JSON.stringify(config));
                      setPhoto(updated.avatar ?? photo);
                      notify("Avatar enregistré");
                      setAvatarStudioOpen(false);
                    }}
                  />
                </div>
              </div>
            )}

            {cropTarget && <ImageCropper target={cropTarget} onCancel={() => setCropTarget(null)} onSave={handleCropSave} />}
          </section>
        </div>
      </main>
    </AppShell>
  );
}

export { ProfileEditor };
