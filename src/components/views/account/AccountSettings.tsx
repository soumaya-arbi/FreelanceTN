"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import {
  accountApi,
  ApiError,
  authApi,
  type AccountChange,
  type BillingProfile,
  type BillingProfileInput,
  type ClientProfile,
  type ClientProfileInput,
  type NotificationPreferences,
  type SecurityOverview,
  type SessionInfo,
  type TeamInviteResult,
  type TeamMember,
  type UserPreferences,
} from "@/lib/api";
import { useUser } from "@/context/UserContext";
import { AVATAR_PRESETS, AvatarBadge } from "./AvatarBadge";
import QRCode from "qrcode";
import { ImageCropper, validateImageFile, type CropTarget } from "./ImageCropper";
import { AvatarStudio } from "./AvatarStudio";

type TabId = "company" | "team" | "billing" | "security" | "notifications" | "preferences";

const CLIENT_TABS: { id: TabId; label: string }[] = [
  { id: "company", label: "Company profile" },
  { id: "team", label: "Team members" },
  { id: "billing", label: "Billing details" },
  { id: "security", label: "Security" },
  { id: "notifications", label: "Notifications" },
  { id: "preferences", label: "Preferences" },
];

const FREELANCER_TABS: { id: TabId; label: string }[] = [
  { id: "security", label: "Security" },
  { id: "notifications", label: "Notifications" },
  { id: "preferences", label: "Preferences" },
];

const INDUSTRIES = [
  "Financial technology",
  "Technology & software",
  "Professional services",
  "Retail & e-commerce",
  "Health & wellness",
  "Education & training",
  "Media & entertainment",
  "Construction & real estate",
  "Transport & logistics",
  "Other",
];

const COMPANY_SIZES = ["1–10 employees", "11–50 employees", "51–200 employees", "201–500 employees", "500+ employees"];

const GOVERNORATES = [
  "Ariana",
  "Béja",
  "Ben Arous",
  "Bizerte",
  "Gabès",
  "Gafsa",
  "Jendouba",
  "Kairouan",
  "Kasserine",
  "Kébili",
  "Le Kef",
  "Mahdia",
  "La Manouba",
  "Médenine",
  "Monastir",
  "Nabeul",
  "Sfax",
  "Sidi Bouzid",
  "Siliana",
  "Sousse",
  "Tataouine",
  "Tozeur",
  "Tunis",
  "Zaghouan",
];

const TIMEZONES = ["Africa/Tunis", "UTC", "Europe/Paris", "Europe/London", "Africa/Casablanca"];

const TEAM_ROLES = ["Admin", "Manager", "Member", "Viewer"];

const MAX_UPLOAD_MB = 5;

const emptyProfileForm: ClientProfileInput = {
  firstName: "",
  lastName: "",
  phone: "",
  companyName: "",
  companyLogo: "",
  coverImage: "",
  industry: "",
  position: "",
  companyWebsite: "",
  companySize: "",
  companyDescription: "",
  country: "Tunisia",
  governorate: "",
  city: "",
  businessAddress: "",
  personalPresentation: "",
  professionalEmail: "",
  professionalPhone: "",
  website: "",
};

const emptyBillingForm: BillingProfileInput = {
  legalName: "",
  billingAddress: "",
  country: "Tunisia",
  governorate: "",
  city: "",
  taxId: "",
  contactName: "",
  contactEmail: "",
  contactPhone: "",
};

const defaultNotifications: NotificationPreferences = {
  emailEnabled: true,
  inAppEnabled: true,
  invitationsEnabled: true,
  projectActivityEnabled: true,
  messagesEnabled: true,
  billingEnabled: true,
};

const defaultPreferences: UserPreferences = {
  language: "fr",
  currency: "TND",
  theme: "light",
  timezone: "Africa/Tunis",
  dateFormat: "DD/MM/YYYY",
  thousandsSeparator: true,
};

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiError) {
    return error.errors.length > 0 ? `${error.message} ${error.errors.join(" ")}` : error.message;
  }
  return fallback;
}

function profileToForm(profile: ClientProfile): ClientProfileInput {
  return {
    firstName: profile.firstName,
    lastName: profile.lastName,
    phone: profile.phone,
    avatarSource: profile.avatarSource,
    avatarPreset: profile.avatarPreset,
    avatarColor: profile.avatarColor,
    companyName: profile.companyName,
    companyLogo: profile.companyLogo,
    coverImage: profile.coverImage,
    industry: profile.industry,
    position: profile.position,
    companyWebsite: profile.companyWebsite,
    companySize: profile.companySize,
    companyDescription: profile.companyDescription,
    country: profile.country,
    governorate: profile.governorate,
    city: profile.city,
    businessAddress: profile.businessAddress,
    personalPresentation: profile.personalPresentation,
    professionalEmail: profile.professionalEmail,
    professionalPhone: profile.professionalPhone,
    website: profile.website,
  };
}

function urlError(value: string, label: string): string {
  if (!value.trim()) return "";
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return `${label} doit commencer par http:// ou https://.`;
    }
    return "";
  } catch {
    return `${label} n'est pas une URL valide.`;
  }
}

export function AccountSettings({ role }: { role: "client" | "freelancer" }) {
  const { authUser, refreshUser } = useUser();
  const isClient = role === "client";
  const tabs = isClient ? CLIENT_TABS : FREELANCER_TABS;

  const [activeTab, setActiveTab] = useState<TabId>(isClient ? "company" : "security");
  const [initialLoading, setInitialLoading] = useState(true);

  const [profile, setProfile] = useState<ClientProfile | null>(null);
  const [profileForm, setProfileForm] = useState<ClientProfileInput>(emptyProfileForm);
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileError, setProfileError] = useState("");
  const [profileSuccess, setProfileSuccess] = useState("");
  const [avatarBusy, setAvatarBusy] = useState(false);
  const [avatarError, setAvatarError] = useState("");
  const [avatarColor, setAvatarColor] = useState("");
  const [avatarStudioOpen, setAvatarStudioOpen] = useState(false);
  const avatarInputRef = useRef<HTMLInputElement | null>(null);
  const coverInputRef = useRef<HTMLInputElement | null>(null);
  const logoInputRef = useRef<HTMLInputElement | null>(null);
  const [cropTarget, setCropTarget] = useState<CropTarget | null>(null);
  const [cropKind, setCropKind] = useState<"avatar" | "cover" | "logo">("avatar");

  const [team, setTeam] = useState<TeamMember[]>([]);
  const [teamLoading, setTeamLoading] = useState(false);
  const [teamError, setTeamError] = useState("");
  const [teamSuccess, setTeamSuccess] = useState("");
  const [teamFilter, setTeamFilter] = useState<"All" | "Pending" | "Active" | "Revoked">("All");
  const [inviteForm, setInviteForm] = useState({ email: "", name: "", role: "Member" });
  const [inviteBusy, setInviteBusy] = useState(false);
  const [inviteResult, setInviteResult] = useState<TeamInviteResult | null>(null);
  const [memberBusy, setMemberBusy] = useState("");

  const [billing, setBilling] = useState<BillingProfile | null>(null);
  const [billingForm, setBillingForm] = useState<BillingProfileInput>(emptyBillingForm);
  const [billingSaving, setBillingSaving] = useState(false);
  const [billingError, setBillingError] = useState("");
  const [billingSuccess, setBillingSuccess] = useState("");

  const [security, setSecurity] = useState<SecurityOverview | null>(null);
  const [passwordForm, setPasswordForm] = useState({ currentPassword: "", newPassword: "", confirmPassword: "" });
  const [passwordBusy, setPasswordBusy] = useState(false);
  const [twoFactorSetup, setTwoFactorSetup] = useState<{ secret: string; otpAuthUri: string } | null>(null);
  const [twoFactorCode, setTwoFactorCode] = useState("");
  const [twoFactorBusy, setTwoFactorBusy] = useState(false);
  const [twoFactorError, setTwoFactorError] = useState("");
  const [twoFactorSuccess, setTwoFactorSuccess] = useState("");
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [twoFactorPassword, setTwoFactorPassword] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [passwordSuccess, setPasswordSuccess] = useState("");
  const [securityError, setSecurityError] = useState("");
  const [sessionBusy, setSessionBusy] = useState("");
  const [resendBusy, setResendBusy] = useState(false);
  const [resendNotice, setResendNotice] = useState("");
  const [history, setHistory] = useState<AccountChange[]>([]);
  const [exportBusy, setExportBusy] = useState(false);

  const [notifications, setNotifications] = useState<NotificationPreferences>(defaultNotifications);
  const [notificationsSaving, setNotificationsSaving] = useState(false);
  const [notificationsError, setNotificationsError] = useState("");
  const [notificationsSuccess, setNotificationsSuccess] = useState("");
  const [emailTransport, setEmailTransport] = useState<"smtp" | "dev-outbox" | "none" | "unknown">("unknown");

  const [preferences, setPreferences] = useState<UserPreferences>(defaultPreferences);
  const [preferencesSaving, setPreferencesSaving] = useState(false);
  const [preferencesError, setPreferencesError] = useState("");
  const [preferencesSuccess, setPreferencesSuccess] = useState("");

  const loadProfile = useCallback(async () => {
    const value = await accountApi.getProfile();
    setProfile(value);
    setProfileForm(profileToForm(value));
    setAvatarColor(value.avatarColor || "");
    return value;
  }, []);

  const loadTeam = useCallback(async () => {
    if (!isClient) return;
    setTeamLoading(true);
    try {
      setTeam(await accountApi.listTeam());
    } finally {
      setTeamLoading(false);
    }
  }, [isClient]);

  const loadSecurity = useCallback(async () => {
    setSecurity(await accountApi.getSecurity());
  }, []);

  const loadHistory = useCallback(async () => {
    setHistory(await accountApi.getHistory());
  }, []);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      setInitialLoading(true);
      const tasks: Promise<unknown>[] = [
        accountApi.getPreferences().then((value) => !cancelled && setPreferences(value)),
        accountApi.getNotifications().then((value) => !cancelled && setNotifications(value)),
        accountApi.getSecurity().then((value) => !cancelled && setSecurity(value)),
        accountApi.getHistory().then((value) => !cancelled && setHistory(value)),
        authApi
          .providers()
          .then((value) => {
            if (!cancelled) setEmailTransport((value.emailTransport ?? "unknown") as typeof emailTransport);
          })
          .catch(() => !cancelled && setEmailTransport("unknown")),
      ];

      if (isClient) {
        tasks.push(
          accountApi.getProfile().then((value) => {
            if (cancelled) return;
            setProfile(value);
            setProfileForm(profileToForm(value));
            setAvatarColor(value.avatarColor || "");
          }),
          accountApi.listTeam().then((value) => !cancelled && setTeam(value)),
          accountApi.getBilling().then((value) => {
            if (cancelled) return;
            setBilling(value);
            setBillingForm({
              legalName: value.legalName,
              billingAddress: value.billingAddress,
              country: value.country || "Tunisia",
              governorate: value.governorate,
              city: value.city,
              taxId: value.taxId,
              contactName: value.contactName,
              contactEmail: value.contactEmail,
              contactPhone: value.contactPhone,
            });
          }),
        );
      }

      await Promise.allSettled(tasks);
      if (!cancelled) setInitialLoading(false);
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [isClient]);

  const setProfileField = <K extends keyof ClientProfileInput>(key: K, value: ClientProfileInput[K]) => {
    setProfileForm((current) => ({ ...current, [key]: value }));
    setProfileSuccess("");
  };

  const filterTeam = useMemo(
    () => (teamFilter === "All" ? team : team.filter((member) => member.status === teamFilter)),
    [team, teamFilter],
  );

  const applyTheme = (theme: "light" | "dark") => {
    document.documentElement.classList.toggle("dark", theme === "dark");
  };

  const submitProfile = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setProfileError("");
    setProfileSuccess("");

    if (!profileForm.firstName?.trim() || !profileForm.lastName?.trim()) {
      setProfileError("Le prénom et le nom sont obligatoires.");
      return;
    }

    const urlIssue =
      urlError(profileForm.companyWebsite ?? "", "Le site web de l'entreprise") ||
      urlError(profileForm.website ?? "", "Le site web personnel");
    if (urlIssue) {
      setProfileError(urlIssue);
      return;
    }

    const professionalEmail = profileForm.professionalEmail?.trim() ?? "";
    if (professionalEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(professionalEmail)) {
      setProfileError("L'e-mail professionnel n'est pas valide.");
      return;
    }

    setProfileSaving(true);
    try {
      const updated = await accountApi.updateProfile(profileForm);
      setProfile(updated);
      setProfileForm(profileToForm(updated));
      await refreshUser();
      setProfileSuccess("Profil enregistré. Les informations seront rechargées à la prochaine connexion.");
    } catch (error) {
      setProfileError(errorMessage(error, "Le profil n'a pas pu être enregistré."));
    } finally {
      setProfileSaving(false);
    }
  };

  const openCrop = (kind: "avatar" | "cover" | "logo", file: File) => {
    const issue = validateImageFile(file, MAX_UPLOAD_MB);
    if (issue) {
      if (kind === "avatar") setAvatarError(issue);
      else setProfileError(issue);
      return;
    }
    setAvatarError("");
    setProfileError("");
    setCropKind(kind);
    setCropTarget({
      file,
      aspect: kind === "cover" ? 16 / 5 : 1,
      outputWidth: kind === "cover" ? 1600 : 512,
      outputHeight: kind === "cover" ? 500 : 512,
      title:
        kind === "avatar"
          ? "Recadrer la photo de profil"
          : kind === "cover"
            ? "Recadrer l'image de couverture"
            : "Recadrer le logo de l'entreprise",
    });
  };

  const handleCropSave = async (file: File) => {
    setCropTarget(null);
    try {
      if (cropKind === "avatar") {
        setAvatarBusy(true);
        await authApi.uploadAvatar(file);
        await refreshUser();
        await loadProfile();
      } else if (cropKind === "cover") {
        const { url } = await accountApi.uploadCover(file);
        setProfile((current) => (current ? { ...current, coverImage: url } : current));
        setProfileForm((current) => ({ ...current, coverImage: url }));
        setProfileSuccess("Image de couverture enregistrée.");
      } else {
        const { url } = await accountApi.uploadLogo(file);
        setProfile((current) => (current ? { ...current, companyLogo: url } : current));
        setProfileForm((current) => ({ ...current, companyLogo: url }));
        setProfileSuccess("Logo de l'entreprise enregistré.");
      }
    } catch (error) {
      const message = errorMessage(error, "L'image n'a pas pu être enregistrée.");
      if (cropKind === "avatar") setAvatarError(message);
      else setProfileError(message);
    } finally {
      setAvatarBusy(false);
    }
  };

  const removeAvatar = async () => {
    setAvatarBusy(true);
    setAvatarError("");
    try {
      await accountApi.deleteAvatar();
      await refreshUser();
      await loadProfile();
    } catch (error) {
      setAvatarError(errorMessage(error, "La photo n'a pas pu être supprimée."));
    } finally {
      setAvatarBusy(false);
    }
  };

  const choosePreset = async (preset: string) => {
    setAvatarBusy(true);
    setAvatarError("");
    try {
      const updated = await accountApi.setAvatarStyle({ source: "preset", preset });
      setProfile(updated);
      setProfileForm(profileToForm(updated));
      await refreshUser();
    } catch (error) {
      setAvatarError(errorMessage(error, "Le style d'avatar n'a pas pu être enregistré."));
    } finally {
      setAvatarBusy(false);
    }
  };

  const applyAvatarColor = async () => {
    if (!/^#[0-9a-fA-F]{6}$/.test(avatarColor)) {
      setAvatarError("La couleur doit être au format #RRGGBB.");
      return;
    }
    setAvatarBusy(true);
    setAvatarError("");
    try {
      const updated = await accountApi.setAvatarStyle({
        source: profile?.avatarSource ?? "preset",
        preset: profile?.avatarPreset || "violet",
        color: avatarColor,
      });
      setProfile(updated);
      setProfileForm(profileToForm(updated));
      await refreshUser();
    } catch (error) {
      setAvatarError(errorMessage(error, "La couleur n'a pas pu être enregistrée."));
    } finally {
      setAvatarBusy(false);
    }
  };

  const removeCover = async () => {
    try {
      await accountApi.deleteCover();
      setProfile((current) => (current ? { ...current, coverImage: "" } : current));
      setProfileForm((current) => ({ ...current, coverImage: "" }));
      setProfileSuccess("Image de couverture supprimée.");
    } catch (error) {
      setProfileError(errorMessage(error, "L'image de couverture n'a pas pu être supprimée."));
    }
  };

  const removeLogo = async () => {
    try {
      await accountApi.deleteLogo();
      setProfile((current) => (current ? { ...current, companyLogo: "" } : current));
      setProfileForm((current) => ({ ...current, companyLogo: "" }));
      setProfileSuccess("Logo supprimé.");
    } catch (error) {
      setProfileError(errorMessage(error, "Le logo n'a pas pu être supprimé."));
    }
  };

  const submitInvite = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setTeamError("");
    setTeamSuccess("");
    setInviteResult(null);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(inviteForm.email.trim())) {
      setTeamError("Saisissez une adresse e-mail valide.");
      return;
    }
    setInviteBusy(true);
    try {
      const result = await accountApi.inviteTeamMember({
        email: inviteForm.email.trim(),
        name: inviteForm.name.trim(),
        role: inviteForm.role,
      });
      setInviteResult(result);
      setTeamSuccess(result.message);
      setInviteForm({ email: "", name: "", role: "Member" });
      await loadTeam();
    } catch (error) {
      setTeamError(errorMessage(error, "L'invitation n'a pas pu être envoyée."));
    } finally {
      setInviteBusy(false);
    }
  };

  const changeMemberRole = async (member: TeamMember, role: string) => {
    setMemberBusy(member.id);
    setTeamError("");
    setTeamSuccess("");
    try {
      const updated = await accountApi.updateTeamRole(member.id, role);
      setTeam((current) => current.map((item) => (item.id === updated.id ? updated : item)));
      setTeamSuccess(`Rôle de ${member.email} mis à jour : ${updated.role}.`);
    } catch (error) {
      setTeamError(errorMessage(error, "Le rôle n'a pas pu être modifié."));
    } finally {
      setMemberBusy("");
    }
  };

  const revokeMember = async (member: TeamMember) => {
    setMemberBusy(member.id);
    setTeamError("");
    setTeamSuccess("");
    try {
      const updated = await accountApi.revokeTeamMember(member.id);
      setTeam((current) => current.map((item) => (item.id === updated.id ? updated : item)));
      setTeamSuccess(`Accès révoqué pour ${member.email}.`);
    } catch (error) {
      setTeamError(errorMessage(error, "L'accès n'a pas pu être révoqué."));
    } finally {
      setMemberBusy("");
    }
  };

  const submitBilling = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBillingError("");
    setBillingSuccess("");
    const contactEmail = billingForm.contactEmail?.trim() ?? "";
    if (contactEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail)) {
      setBillingError("L'e-mail de contact n'est pas valide.");
      return;
    }
    setBillingSaving(true);
    try {
      const updated = await accountApi.updateBilling(billingForm);
      setBilling(updated);
      setBillingSuccess("Informations de facturation enregistrées.");
    } catch (error) {
      setBillingError(errorMessage(error, "Les informations de facturation n'ont pas pu être enregistrées."));
    } finally {
      setBillingSaving(false);
    }
  };

  const submitPassword = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setPasswordError("");
    setPasswordSuccess("");
    if (passwordForm.newPassword.length < 8) {
      setPasswordError("Le nouveau mot de passe doit contenir au moins 8 caractères.");
      return;
    }
    if (passwordForm.newPassword !== passwordForm.confirmPassword) {
      setPasswordError("Les deux nouveaux mots de passe ne correspondent pas.");
      return;
    }
    setPasswordBusy(true);
    try {
      const response = await accountApi.changePassword({
        currentPassword: passwordForm.currentPassword,
        newPassword: passwordForm.newPassword,
      });
      setPasswordSuccess(response.message);
      setPasswordForm({ currentPassword: "", newPassword: "", confirmPassword: "" });
      await loadSecurity();
      await loadHistory();
    } catch (error) {
      setPasswordError(errorMessage(error, "Le mot de passe n'a pas pu être modifié."));
    } finally {
      setPasswordBusy(false);
    }
  };

  const resendVerification = async () => {
    const email = authUser?.email ?? profile?.email ?? "";
    if (!email) return;
    setResendBusy(true);
    setResendNotice("");
    setSecurityError("");
    try {
      const response = await authApi.resendVerification(email);
      setResendNotice(
        response.devVerificationUrl
          ? `E-mail enregistré dans le dossier de développement. Lien : ${response.devVerificationUrl}`
          : response.message,
      );
    } catch (error) {
      setSecurityError(errorMessage(error, "L'e-mail de vérification n'a pas pu être renvoyé."));
    } finally {
      setResendBusy(false);
    }
  };

  const revokeSession = async (session: SessionInfo) => {
    setSessionBusy(session.id);
    setSecurityError("");
    try {
      await accountApi.revokeSession(session.id);
      await loadSecurity();
    } catch (error) {
      setSecurityError(errorMessage(error, "La session n'a pas pu être déconnectée."));
    } finally {
      setSessionBusy("");
    }
  };

  const revokeOtherSessions = async () => {
    setSessionBusy("others");
    setSecurityError("");
    try {
      const response = await accountApi.revokeOtherSessions();
      setResendNotice(response.message);
      await loadSecurity();
    } catch (error) {
      setSecurityError(errorMessage(error, "Les autres sessions n'ont pas pu être déconnectées."));
    } finally {
      setSessionBusy("");
    }
  };

  const exportAccount = async () => {
    setExportBusy(true);
    setSecurityError("");
    try {
      const data = await accountApi.exportAccount();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `freelancetn-account-${new Date().toISOString().slice(0, 10)}.json`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      setSecurityError(errorMessage(error, "L'export des données n'a pas pu être généré."));
    } finally {
      setExportBusy(false);
    }
  };

  const saveNotifications = async () => {
    setNotificationsSaving(true);
    setNotificationsError("");
    setNotificationsSuccess("");
    try {
      const updated = await accountApi.updateNotifications(notifications);
      setNotifications(updated);
      setNotificationsSuccess("Préférences de notification enregistrées.");
    } catch (error) {
      setNotificationsError(errorMessage(error, "Les préférences n'ont pas pu être enregistrées."));
    } finally {
      setNotificationsSaving(false);
    }
  };

  const savePreferences = async () => {
    setPreferencesSaving(true);
    setPreferencesError("");
    setPreferencesSuccess("");
    try {
      const updated = await accountApi.updatePreferences(preferences);
      setPreferences(updated);
      applyTheme(updated.theme);
      setPreferencesSuccess("Préférences enregistrées.");
      await loadHistory();
    } catch (error) {
      setPreferencesError(errorMessage(error, "Les préférences n'ont pas pu être enregistrées."));
    } finally {
      setPreferencesSaving(false);
    }
  };

  const completion = profile?.profileCompletion ?? 0;

  if (initialLoading) {
    return (
      <div className="settings-layout account-settings">
        <nav>
          {tabs.map((tab) => (
            <button key={tab.id} className={activeTab === tab.id ? "active" : ""} disabled>
              {tab.label}
              <Icon name="chevron" />
            </button>
          ))}
        </nav>
        <section className="settings-panel">
          <div className="settings-skeleton" aria-live="polite">
            <span />
            <span />
            <span />
            <span />
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="settings-layout account-settings">
      <nav>
        {tabs.map((tab) => (
          <button
            key={tab.id}
            className={activeTab === tab.id ? "active" : ""}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
            <Icon name="chevron" />
          </button>
        ))}
      </nav>

      <section className="settings-panel">
        {activeTab === "company" && isClient && (
          <div className="settings-block">
            <header className="settings-head">
              <div>
                <h2>Company profile</h2>
                <p>Les informations enregistrées sont rechargées automatiquement à chaque connexion.</p>
              </div>
              <div className="completion-ring" aria-label={`Profil complété à ${completion}%`}>
                <strong>{completion}%</strong>
                <span>complété</span>
              </div>
            </header>

            <div className="completion-bar" aria-hidden="true">
              <span style={{ width: `${completion}%` }} />
            </div>
            {profile && profile.missingFields.length > 0 && (
              <p className="completion-missing">
                À compléter : {profile.missingFields.slice(0, 6).join(", ")}
                {profile.missingFields.length > 6 ? "…" : ""}
              </p>
            )}

            <div className="cover-editor">
              <div className="cover-preview">
                {profileForm.coverImage ? (
                  <img src={profileForm.coverImage} alt="Couverture de l'entreprise" />
                ) : (
                  <span>
                    <Icon name="image" size={20} /> Aucune image de couverture
                  </span>
                )}
              </div>
              <div className="cover-actions">
                <Button variant="secondary" onClick={() => coverInputRef.current?.click()}>
                  {profileForm.coverImage ? "Remplacer la couverture" : "Upload cover"}
                </Button>
                {profileForm.coverImage && (
                  <button type="button" className="ghost-danger" onClick={removeCover}>
                    Supprimer
                  </button>
                )}
                <small>JPG, PNG ou WebP · {MAX_UPLOAD_MB} Mo maximum · recadrage avant envoi.</small>
              </div>
              <input
                ref={coverInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                hidden
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = "";
                  if (file) openCrop("cover", file);
                }}
              />
            </div>

            <div className="avatar-editor">
              <AvatarBadge
                url={profile?.avatar || undefined}
                firstName={profileForm.firstName ?? ""}
                lastName={profileForm.lastName ?? ""}
                preset={profile?.avatarPreset}
                color={avatarColor}
                size={84}
                source={profile?.avatarSource}
                avatarConfig={profile?.avatarConfig}
              />
              <div className="avatar-editor-body">
                <div className="avatar-actions">
                  <Button variant="secondary" onClick={() => avatarInputRef.current?.click()} disabled={avatarBusy}>
                    {profile?.avatar ? "Remplacer la photo" : "Upload photo"}
                  </Button>
                  {profile?.avatar && (
                    <button type="button" className="ghost-danger" onClick={removeAvatar} disabled={avatarBusy}>
                      Supprimer la photo
                    </button>
                  )}
                </div>
                <div className="avatar-presets" aria-label="Avatars prédéfinis">
                  {AVATAR_PRESETS.map((preset) => (
                    <button
                      key={preset.id}
                      type="button"
                      className={`avatar-preset ${profile?.avatarPreset === preset.id ? "active" : ""}`}
                      style={{ background: `linear-gradient(145deg, ${preset.from}, ${preset.to})` }}
                      onClick={() => choosePreset(preset.id)}
                      disabled={avatarBusy}
                      title={preset.label}
                      aria-label={`Avatar ${preset.label}`}
                    />
                  ))}
                  <label className="avatar-color">
                    <input
                      type="color"
                      value={/^#[0-9a-fA-F]{6}$/.test(avatarColor) ? avatarColor : "#5145e5"}
                      onChange={(event) => setAvatarColor(event.target.value)}
                      onBlur={applyAvatarColor}
                      aria-label="Couleur personnalisée de l'avatar"
                    />
                  </label>
                </div>
                <small>
                  La <b>photo réelle</b> reste principale. L&apos;avatar personnalisé créé dans Avatar Studio s&apos;affiche en complément (petit badge). La photo et l&apos;avatar sont enregistrés séparément.
                </small>
              </div>
              <input
                ref={avatarInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                hidden
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = "";
                  if (file) openCrop("avatar", file);
                }}
              />
            </div>

            <div className="settings-actions">
              <Button variant="secondary" onClick={() => setAvatarStudioOpen(true)}>
                {profile?.avatarConfig ? "Modifier l'avatar personnalisé" : "Créer mon avatar personnalisé"}
              </Button>
            </div>

            {avatarError && <p className="form-error" role="alert">{avatarError}</p>}

            <form onSubmit={submitProfile}>
              <h3 className="settings-subtitle">Informations personnelles</h3>
              <div className="settings-grid">
                <label className="settings-field">
                  <span>Prénom</span>
                  <input
                    value={profileForm.firstName ?? ""}
                    onChange={(event) => setProfileField("firstName", event.target.value)}
                    maxLength={80}
                    required
                  />
                </label>
                <label className="settings-field">
                  <span>Nom</span>
                  <input
                    value={profileForm.lastName ?? ""}
                    onChange={(event) => setProfileField("lastName", event.target.value)}
                    maxLength={80}
                    required
                  />
                </label>
                <label className="settings-field">
                  <span>Téléphone</span>
                  <input
                    value={profileForm.phone ?? ""}
                    onChange={(event) => setProfileField("phone", event.target.value)}
                    maxLength={40}
                    placeholder="+216 00 000 000"
                  />
                </label>
                <label className="settings-field">
                  <span>Adresse e-mail (lecture seule)</span>
                  <input value={profile?.email ?? ""} readOnly />
                  <small>Pour changer d&apos;e-mail, contactez le support : la modification n&apos;est pas exposée.</small>
                </label>
              </div>

              <h3 className="settings-subtitle">Entreprise</h3>
              <div className="settings-grid">
                <label className="settings-field">
                  <span>Nom de l&apos;entreprise</span>
                  <input
                    value={profileForm.companyName ?? ""}
                    onChange={(event) => setProfileField("companyName", event.target.value)}
                    maxLength={160}
                  />
                </label>
                <label className="settings-field">
                  <span>Poste occupé</span>
                  <input
                    value={profileForm.position ?? ""}
                    onChange={(event) => setProfileField("position", event.target.value)}
                    maxLength={120}
                  />
                </label>
                <label className="settings-field">
                  <span>Secteur d&apos;activité</span>
                  <select
                    value={profileForm.industry ?? ""}
                    onChange={(event) => setProfileField("industry", event.target.value)}
                  >
                    <option value="">Sélectionner un secteur</option>
                    {INDUSTRIES.map((industry) => (
                      <option key={industry} value={industry}>{industry}</option>
                    ))}
                  </select>
                </label>
                <label className="settings-field">
                  <span>Taille de l&apos;entreprise</span>
                  <select
                    value={profileForm.companySize ?? ""}
                    onChange={(event) => setProfileField("companySize", event.target.value)}
                  >
                    <option value="">Sélectionner une taille</option>
                    {COMPANY_SIZES.map((size) => (
                      <option key={size} value={size}>{size}</option>
                    ))}
                  </select>
                </label>
                <label className="settings-field">
                  <span>Site web de l&apos;entreprise</span>
                  <input
                    value={profileForm.companyWebsite ?? ""}
                    onChange={(event) => setProfileField("companyWebsite", event.target.value)}
                    maxLength={500}
                    placeholder="https://"
                  />
                </label>
                <label className="settings-field">
                  <span>Site web personnel</span>
                  <input
                    value={profileForm.website ?? ""}
                    onChange={(event) => setProfileField("website", event.target.value)}
                    maxLength={500}
                    placeholder="https://"
                  />
                </label>
              </div>

              <div className="logo-editor">
                <div className="logo-preview">
                  {profileForm.companyLogo ? (
                    <img src={profileForm.companyLogo} alt="Logo de l'entreprise" />
                  ) : (
                    <span>{profileForm.companyName?.charAt(0) || "C"}</span>
                  )}
                </div>
                <div>
                  <Button variant="secondary" onClick={() => logoInputRef.current?.click()}>
                    {profileForm.companyLogo ? "Remplacer le logo" : "Upload logo"}
                  </Button>
                  {profileForm.companyLogo && (
                    <button type="button" className="ghost-danger" onClick={removeLogo}>
                      Supprimer
                    </button>
                  )}
                  <small>PNG, JPG ou WebP. Le logo est stocké côté serveur, pas en base64.</small>
                </div>
                <input
                  ref={logoInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  hidden
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    event.target.value = "";
                    if (file) openCrop("logo", file);
                  }}
                />
              </div>

              <label className="settings-field">
                <span>Description de l&apos;entreprise</span>
                <textarea
                  value={profileForm.companyDescription ?? ""}
                  onChange={(event) => setProfileField("companyDescription", event.target.value)}
                  maxLength={2000}
                  placeholder="Présentez votre entreprise, vos activités et vos besoins."
                />
              </label>

              <h3 className="settings-subtitle">Localisation</h3>
              <div className="settings-grid">
                <label className="settings-field">
                  <span>Pays</span>
                  <input
                    value={profileForm.country ?? ""}
                    onChange={(event) => setProfileField("country", event.target.value)}
                    maxLength={120}
                  />
                </label>
                <label className="settings-field">
                  <span>Gouvernorat</span>
                  <select
                    value={profileForm.governorate ?? ""}
                    onChange={(event) => setProfileField("governorate", event.target.value)}
                  >
                    <option value="">Sélectionner un gouvernorat</option>
                    {GOVERNORATES.map((governorate) => (
                      <option key={governorate} value={governorate}>{governorate}</option>
                    ))}
                  </select>
                </label>
                <label className="settings-field">
                  <span>Ville</span>
                  <input
                    value={profileForm.city ?? ""}
                    onChange={(event) => setProfileField("city", event.target.value)}
                    maxLength={120}
                  />
                </label>
                <label className="settings-field">
                  <span>Adresse professionnelle</span>
                  <input
                    value={profileForm.businessAddress ?? ""}
                    onChange={(event) => setProfileField("businessAddress", event.target.value)}
                    maxLength={300}
                  />
                </label>
              </div>

              <h3 className="settings-subtitle">Présentation et coordonnées professionnelles</h3>
              <label className="settings-field">
                <span>Présentation personnelle</span>
                <textarea
                  value={profileForm.personalPresentation ?? ""}
                  onChange={(event) => setProfileField("personalPresentation", event.target.value)}
                  maxLength={2000}
                  placeholder="Votre parcours, votre rôle et ce que vous recherchez."
                />
              </label>
              <div className="settings-grid">
                <label className="settings-field">
                  <span>E-mail professionnel</span>
                  <input
                    type="email"
                    value={profileForm.professionalEmail ?? ""}
                    onChange={(event) => setProfileField("professionalEmail", event.target.value)}
                    maxLength={254}
                  />
                </label>
                <label className="settings-field">
                  <span>Téléphone professionnel</span>
                  <input
                    value={profileForm.professionalPhone ?? ""}
                    onChange={(event) => setProfileField("professionalPhone", event.target.value)}
                    maxLength={40}
                  />
                </label>
              </div>

              {profileError && <p className="form-error" role="alert">{profileError}</p>}
              {profileSuccess && <p className="form-success" role="status">{profileSuccess}</p>}

              <div className="settings-actions">
                <Button type="submit" disabled={profileSaving}>
                  {profileSaving ? "Enregistrement..." : "Enregistrer le profil"}
                </Button>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => {
                    if (profile) {
                      setProfileForm(profileToForm(profile));
                      setAvatarColor(profile.avatarColor || "");
                      setProfileError("");
                      setProfileSuccess("");
                    }
                  }}
                >
                  Annuler les modifications
                </button>
              </div>
            </form>
          </div>
        )}

        {activeTab === "team" && isClient && (
          <div className="settings-block">
            <header className="settings-head">
              <div>
                <h2>Team members</h2>
                <p>Invitez des collaborateurs et gérez leurs droits. Les permissions sont contrôlées côté serveur.</p>
              </div>
            </header>

            <div className="owner-card">
              <AvatarBadge
                url={authUser?.avatar || undefined}
                firstName={authUser?.firstName ?? ""}
                lastName={authUser?.lastName ?? ""}
                preset={authUser?.avatarPreset}
                color={authUser?.avatarColor}
                size={44}
                source={authUser?.avatarSource}
                avatarConfig={authUser?.avatarConfig}
              />
              <div>
                <b>{[authUser?.firstName, authUser?.lastName].filter(Boolean).join(" ") || authUser?.email}</b>
                <small>{authUser?.email} · Owner (vous)</small>
              </div>
              <span className="status-pill active">Active</span>
            </div>

            <form className="invite-form" onSubmit={submitInvite}>
              <div className="settings-grid">
                <label className="settings-field">
                  <span>E-mail du collaborateur</span>
                  <input
                    type="email"
                    value={inviteForm.email}
                    onChange={(event) => setInviteForm((current) => ({ ...current, email: event.target.value }))}
                    placeholder="collaborateur@entreprise.tn"
                    required
                  />
                </label>
                <label className="settings-field">
                  <span>Nom (facultatif)</span>
                  <input
                    value={inviteForm.name}
                    onChange={(event) => setInviteForm((current) => ({ ...current, name: event.target.value }))}
                    maxLength={120}
                  />
                </label>
                <label className="settings-field">
                  <span>Rôle</span>
                  <select
                    value={inviteForm.role}
                    onChange={(event) => setInviteForm((current) => ({ ...current, role: event.target.value }))}
                  >
                    {TEAM_ROLES.map((roleValue) => (
                      <option key={roleValue} value={roleValue}>{roleValue}</option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="settings-actions">
                <Button type="submit" disabled={inviteBusy}>
                  {inviteBusy ? "Envoi..." : "Inviter un membre"}
                </Button>
                <small className="permission-note">
                  Admin : gestion complète · Manager : projets et équipe · Member : contribution · Viewer : lecture.
                </small>
              </div>
            </form>

            {teamError && <p className="form-error" role="alert">{teamError}</p>}
            {teamSuccess && <p className="form-success" role="status">{teamSuccess}</p>}
            {inviteResult?.devInviteUrl && (
              <p className="form-notice">
                Mode développement : <a href={inviteResult.devInviteUrl}>accepter l&apos;invitation</a>
              </p>
            )}

            <div className="module-tabs team-tabs">
              {(["All", "Pending", "Active", "Revoked"] as const).map((filter) => (
                <button
                  key={filter}
                  className={teamFilter === filter ? "active" : ""}
                  onClick={() => setTeamFilter(filter)}
                  type="button"
                >
                  {filter}
                </button>
              ))}
            </div>

            {teamLoading ? (
              <p className="task-empty">Chargement des membres…</p>
            ) : filterTeam.length === 0 ? (
              <div className="empty-state">
                <span><Icon name="users" size={20} /></span>
                <b>Aucun membre dans cette vue</b>
                <p>Les invitations en attente et les accès actifs apparaîtront ici.</p>
              </div>
            ) : (
              <div className="team-list">
                {filterTeam.map((member) => (
                  <article className="team-row" key={member.id}>
                    <AvatarBadge firstName={member.name || member.email} lastName="" size={40} />
                    <div className="team-main">
                      <b>{member.name || member.email}</b>
                      <small>{member.email}</small>
                    </div>
                    <span className={`status-pill ${member.status.toLowerCase()}`}>{member.status}</span>
                    <select
                      value={member.role}
                      disabled={member.status === "Revoked" || member.status === "Declined" || memberBusy === member.id}
                      onChange={(event) => changeMemberRole(member, event.target.value)}
                      aria-label={`Rôle de ${member.email}`}
                    >
                      {TEAM_ROLES.map((roleValue) => (
                        <option key={roleValue} value={roleValue}>{roleValue}</option>
                      ))}
                    </select>
                    {member.status !== "Revoked" && member.status !== "Declined" ? (
                      <button
                        type="button"
                        className="ghost-danger"
                        onClick={() => revokeMember(member)}
                        disabled={memberBusy === member.id}
                      >
                        Révoquer
                      </button>
                    ) : (
                      <span className="team-muted">—</span>
                    )}
                  </article>
                ))}
              </div>
            )}
          </div>
        )}

        {activeTab === "billing" && isClient && (
          <div className="settings-block">
            <header className="settings-head">
              <div>
                <h2>Billing details</h2>
                <p>Coordonnées légales utilisées pour la facturation. Aucun paiement n&apos;est géré dans cet écran.</p>
              </div>
            </header>

            <form onSubmit={submitBilling}>
              <div className="settings-grid">
                <label className="settings-field">
                  <span>Nom légal de l&apos;entreprise / du client</span>
                  <input
                    value={billingForm.legalName ?? ""}
                    onChange={(event) => setBillingForm((current) => ({ ...current, legalName: event.target.value }))}
                    maxLength={200}
                  />
                </label>
                <label className="settings-field">
                  <span>Identifiant fiscal</span>
                  <input
                    value={billingForm.taxId ?? ""}
                    onChange={(event) => setBillingForm((current) => ({ ...current, taxId: event.target.value }))}
                    maxLength={60}
                    placeholder="Matricule fiscal si applicable"
                  />
                </label>
                <label className="settings-field settings-field-wide">
                  <span>Adresse de facturation</span>
                  <input
                    value={billingForm.billingAddress ?? ""}
                    onChange={(event) => setBillingForm((current) => ({ ...current, billingAddress: event.target.value }))}
                    maxLength={300}
                  />
                </label>
                <label className="settings-field">
                  <span>Pays</span>
                  <input
                    value={billingForm.country ?? ""}
                    onChange={(event) => setBillingForm((current) => ({ ...current, country: event.target.value }))}
                    maxLength={120}
                  />
                </label>
                <label className="settings-field">
                  <span>Gouvernorat</span>
                  <select
                    value={billingForm.governorate ?? ""}
                    onChange={(event) => setBillingForm((current) => ({ ...current, governorate: event.target.value }))}
                  >
                    <option value="">Sélectionner un gouvernorat</option>
                    {GOVERNORATES.map((governorate) => (
                      <option key={governorate} value={governorate}>{governorate}</option>
                    ))}
                  </select>
                </label>
                <label className="settings-field">
                  <span>Ville</span>
                  <input
                    value={billingForm.city ?? ""}
                    onChange={(event) => setBillingForm((current) => ({ ...current, city: event.target.value }))}
                    maxLength={120}
                  />
                </label>
                <label className="settings-field">
                  <span>Nom du contact</span>
                  <input
                    value={billingForm.contactName ?? ""}
                    onChange={(event) => setBillingForm((current) => ({ ...current, contactName: event.target.value }))}
                    maxLength={160}
                  />
                </label>
                <label className="settings-field">
                  <span>E-mail de contact</span>
                  <input
                    type="email"
                    value={billingForm.contactEmail ?? ""}
                    onChange={(event) => setBillingForm((current) => ({ ...current, contactEmail: event.target.value }))}
                    maxLength={254}
                  />
                </label>
                <label className="settings-field">
                  <span>Téléphone de contact</span>
                  <input
                    value={billingForm.contactPhone ?? ""}
                    onChange={(event) => setBillingForm((current) => ({ ...current, contactPhone: event.target.value }))}
                    maxLength={40}
                  />
                </label>
              </div>

              {billingError && <p className="form-error" role="alert">{billingError}</p>}
              {billingSuccess && <p className="form-success" role="status">{billingSuccess}</p>}

              <div className="settings-actions">
                <Button type="submit" disabled={billingSaving}>
                  {billingSaving ? "Enregistrement..." : "Enregistrer la facturation"}
                </Button>
                {billing?.updatedAt && (
                  <small>Dernière mise à jour : {new Date(billing.updatedAt).toLocaleString("fr-TN")}</small>
                )}
              </div>
            </form>

            <div className="settings-history">
              <h3 className="settings-subtitle">Historique des informations de facturation</h3>
              {billing && billing.history.length > 0 ? (
                <ul>
                  {billing.history.slice(0, 10).map((entry, index) => (
                    <li key={`${entry.changedAt}-${index}`}>
                      <b>{new Date(entry.changedAt).toLocaleString("fr-TN")}</b>
                      <span>{entry.fields.length > 0 ? entry.fields.join(", ") : "Enregistrement"}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="task-empty">Aucune modification de facturation enregistrée pour le moment.</p>
              )}
            </div>
          </div>
        )}

        {activeTab === "security" && (
          <div className="settings-block">
            <header className="settings-head">
              <div>
                <h2>Security</h2>
                <p>Mot de passe, vérification e-mail et sessions actives.</p>
              </div>
            </header>

            {securityError && <p className="form-error" role="alert">{securityError}</p>}

            <div className="security-card">
              <div>
                <b>Adresse e-mail</b>
                <small>{security?.email ?? authUser?.email}</small>
              </div>
              <span className={`status-pill ${security?.emailVerified ? "active" : "pending"}`}>
                {security?.emailVerified ? "Vérifiée" : "Non vérifiée"}
              </span>
              {!security?.emailVerified && (
                <Button variant="secondary" onClick={resendVerification} disabled={resendBusy}>
                  {resendBusy ? "Envoi..." : "Renvoyer l'e-mail de vérification"}
                </Button>
              )}
            </div>
            {resendNotice && <p className="form-notice">{resendNotice}</p>}

            <form onSubmit={submitPassword} className="security-card security-password">
              <h3 className="settings-subtitle">Modifier le mot de passe</h3>
              {!security?.hasPassword && (
                <p className="form-notice">
                  Ce compte utilise la connexion Google : définissez un mot de passe via « Mot de passe oublié ».
                </p>
              )}
              <div className="settings-grid">
                <label className="settings-field">
                  <span>Mot de passe actuel</span>
                  <input
                    type="password"
                    autoComplete="current-password"
                    value={passwordForm.currentPassword}
                    onChange={(event) => setPasswordForm((current) => ({ ...current, currentPassword: event.target.value }))}
                    required
                    disabled={!security?.hasPassword}
                  />
                </label>
                <label className="settings-field">
                  <span>Nouveau mot de passe</span>
                  <input
                    type="password"
                    autoComplete="new-password"
                    minLength={8}
                    value={passwordForm.newPassword}
                    onChange={(event) => setPasswordForm((current) => ({ ...current, newPassword: event.target.value }))}
                    required
                    disabled={!security?.hasPassword}
                  />
                </label>
                <label className="settings-field">
                  <span>Confirmer le nouveau mot de passe</span>
                  <input
                    type="password"
                    autoComplete="new-password"
                    minLength={8}
                    value={passwordForm.confirmPassword}
                    onChange={(event) => setPasswordForm((current) => ({ ...current, confirmPassword: event.target.value }))}
                    required
                    disabled={!security?.hasPassword}
                  />
                </label>
              </div>
              {passwordError && <p className="form-error" role="alert">{passwordError}</p>}
              {passwordSuccess && <p className="form-success" role="status">{passwordSuccess}</p>}
              <div className="settings-actions">
                <Button type="submit" disabled={passwordBusy || !security?.hasPassword}>
                  {passwordBusy ? "Mise à jour..." : "Modifier le mot de passe"}
                </Button>
                <small>Les autres sessions seront déconnectées après le changement.</small>
              </div>
            </form>

            <div className="security-card two-factor-card">
              <div>
                <b>Double authentification (2FA)</b>
                <small>{security?.twoFactorMessage}</small>
                {security?.twoFactorEnabled && (
                  <>
                    <small>Activée le : {security.twoFactorEnabledAt ? new Date(security.twoFactorEnabledAt).toLocaleString("fr-TN") : "—"}</small>
                    <small>Codes de récupération restants : {security.recoveryCodesRemaining}</small>
                  </>
                )}
              </div>
              <span className={`status-pill ${security?.twoFactorEnabled ? "active" : "pending"}`}>
                {security?.twoFactorEnabled ? "Activée" : "Désactivée"}
              </span>
            </div>

            {!security?.twoFactorEnabled && (
              <div className="security-card">
                <h3 className="settings-subtitle">Activer la 2FA</h3>
                {!twoFactorSetup ? (
                  <Button
                    onClick={async () => {
                      setTwoFactorBusy(true);
                      setTwoFactorError("");
                      try {
                        const result = await accountApi.setupTwoFactor();
                        setTwoFactorSetup(result);
                      } catch (error) {
                        setTwoFactorError(errorMessage(error, "La configuration 2FA a échoué."));
                      } finally {
                        setTwoFactorBusy(false);
                      }
                    }}
                    disabled={twoFactorBusy}
                  >
                    {twoFactorBusy ? "Préparation..." : "Configurer la 2FA"}
                  </Button>
                ) : (
                  <>
                    <p>Scannez ce QR Code avec votre application d'authentification.</p>
                    <QrCodeImage value={twoFactorSetup.otpAuthUri} />
                    <small>Secret : {twoFactorSetup.secret}</small>
                    <label className="settings-field">
                      <span>Code à 6 chiffres</span>
                      <input
                        type="text"
                        inputMode="numeric"
                        pattern="[0-9]{6}"
                        maxLength={6}
                        value={twoFactorCode}
                        onChange={(event) => setTwoFactorCode(event.target.value)}
                      />
                    </label>
                    {twoFactorError && <p className="form-error" role="alert">{twoFactorError}</p>}
                    {twoFactorSuccess && <p className="form-success" role="status">{twoFactorSuccess}</p>}
                    <div className="settings-actions">
                      <Button
                        onClick={async () => {
                          setTwoFactorBusy(true);
                          setTwoFactorError("");
                          try {
                            const result = await accountApi.enableTwoFactor(twoFactorCode);
                            setRecoveryCodes(result.recoveryCodes);
                            setTwoFactorSuccess("2FA activée. Conservez vos codes de récupération.");
                            setTwoFactorSetup(null);
                            setTwoFactorCode("");
                            await loadSecurity();
                          } catch (error) {
                            setTwoFactorError(errorMessage(error, "Activation 2FA échouée."));
                          } finally {
                            setTwoFactorBusy(false);
                          }
                        }}
                        disabled={twoFactorBusy}
                      >
                        {twoFactorBusy ? "Activation..." : "Confirmer"}
                      </Button>
                    </div>
                  </>
                )}
                {twoFactorError && <p className="form-error" role="alert">{twoFactorError}</p>}
              </div>
            )}

            {security?.twoFactorEnabled && (
              <div className="security-card">
                <h3 className="settings-subtitle">Gérer la 2FA</h3>
                <label className="settings-field">
                  <span>Mot de passe</span>
                  <input
                    type="password"
                    value={twoFactorPassword}
                    onChange={(event) => setTwoFactorPassword(event.target.value)}
                  />
                </label>
                {twoFactorError && <p className="form-error" role="alert">{twoFactorError}</p>}
                {twoFactorSuccess && <p className="form-success" role="status">{twoFactorSuccess}</p>}
                <div className="settings-actions">
                  <Button
                    onClick={async () => {
                      setTwoFactorBusy(true);
                      setTwoFactorError("");
                      try {
                        const result = await accountApi.regenerateRecoveryCodes(twoFactorPassword);
                        setRecoveryCodes(result.recoveryCodes);
                        setTwoFactorSuccess("Codes régénérés.");
                      } catch (error) {
                        setTwoFactorError(errorMessage(error, "Régénération échouée."));
                      } finally {
                        setTwoFactorBusy(false);
                      }
                    }}
                    disabled={twoFactorBusy}
                  >
                    Régénérer les codes
                  </Button>
                  <Button
                    variant="secondary"
                    onClick={async () => {
                      setTwoFactorBusy(true);
                      setTwoFactorError("");
                      try {
                        await accountApi.disableTwoFactor(twoFactorPassword);
                        setTwoFactorSuccess("2FA désactivée.");
                        setTwoFactorPassword("");
                        setRecoveryCodes([]);
                        await loadSecurity();
                      } catch (error) {
                        setTwoFactorError(errorMessage(error, "Désactivation échouée."));
                      } finally {
                        setTwoFactorBusy(false);
                      }
                    }}
                    disabled={twoFactorBusy}
                  >
                    Désactiver
                  </Button>
                </div>
              </div>
            )}

            {recoveryCodes.length > 0 && (
              <div className="security-card">
                <h3 className="settings-subtitle">Codes de récupération</h3>
                <pre>{recoveryCodes.join("\n")}</pre>
                <Button
                  variant="secondary"
                  onClick={() => {
                    const blob = new Blob([recoveryCodes.join("\n")], { type: "text/plain" });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement("a");
                    a.href = url;
                    a.download = "recovery-codes.txt";
                    a.click();
                    URL.revokeObjectURL(url);
                  }}
                >
                  Télécharger
                </Button>
              </div>
            )}

            <div className="sessions-block">
              <div className="sessions-head">
                <h3 className="settings-subtitle">Sessions et appareils</h3>
                <Button variant="secondary" onClick={revokeOtherSessions} disabled={sessionBusy === "others"}>
                  {sessionBusy === "others" ? "Déconnexion..." : "Déconnecter les autres sessions"}
                </Button>
              </div>
              {security && security.sessions.length > 0 ? (
                <div className="session-list">
                  {security.sessions.map((session) => (
                    <article className="session-row" key={session.id}>
                      <span className="session-icon"><Icon name="shield" size={16} /></span>
                      <div>
                        <b>
                          {session.current ? "Cet appareil" : "Appareil distant"}
                          {session.rememberMe ? " · session persistante" : " · session navigateur"}
                        </b>
                        <small>{session.userAgent || "Navigateur non identifié"}</small>
                        <small>
                          Dernière activité : {new Date(session.lastSeenAt).toLocaleString("fr-TN")} · expire :{" "}
                          {new Date(session.expiresAt).toLocaleString("fr-TN")}
                        </small>
                      </div>
                      {!session.current && (
                        <button
                          type="button"
                          className="ghost-danger"
                          onClick={() => revokeSession(session)}
                          disabled={sessionBusy === session.id}
                        >
                          Déconnecter
                        </button>
                      )}
                    </article>
                  ))}
                </div>
              ) : (
                <p className="task-empty">Aucune session active enregistrée.</p>
              )}
            </div>

            <div className="settings-history">
              <h3 className="settings-subtitle">Historique des modifications du compte</h3>
              {history.length > 0 ? (
                <ul>
                  {history.slice(0, 12).map((entry, index) => (
                    <li key={`${entry.createdAt}-${index}`}>
                      <b>{entry.area}</b>
                      <span>{entry.summary}</span>
                      <small>{new Date(entry.createdAt).toLocaleString("fr-TN")}</small>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="task-empty">Aucune modification importante enregistrée.</p>
              )}
            </div>

            <div className="security-card">
              <div>
                <b>Exporter mes données personnelles</b>
                <small>Télécharge un fichier JSON contenant le profil, la facturation, l&apos;équipe et les préférences.</small>
              </div>
              <Button variant="secondary" onClick={exportAccount} disabled={exportBusy}>
                {exportBusy ? "Préparation..." : "Exporter en JSON"}
              </Button>
            </div>
          </div>
        )}

        {activeTab === "notifications" && (
          <div className="settings-block">
            <header className="settings-head">
              <div>
                <h2>Notifications</h2>
                <p>
                  Ces préférences sont enregistrées et appliquées à la liste des notifications dans l&apos;application.
                </p>
              </div>
            </header>

            <p className="transport-note">
              Transport e-mail actuel : <b>{emailTransport}</b>
              {emailTransport === "none" &&
                " — aucun fournisseur n'est configuré : aucun e-mail réel n'est envoyé."}
              {emailTransport === "dev-outbox" &&
                " — mode développement : les e-mails sont écrits dans App_Data/dev-emails, pas expédiés."}
            </p>

            <div className="toggle-list">
              {(
                [
                  ["inAppEnabled", "Notifications dans l'application", "Afficher les notifications dans le centre de notifications."],
                  ["emailEnabled", "Notifications par e-mail", "Conserver l'accord pour les e-mails transactionnels lorsque le fournisseur sera configuré."],
                  ["invitationsEnabled", "Invitations", "Invitations d'équipe et propositions."],
                  ["projectActivityEnabled", "Activité des projets", "Statuts, approbations et évaluations de projets."],
                  ["messagesEnabled", "Messages et commentaires", "Commentaires et échanges sur les tâches."],
                  ["billingEnabled", "Facturation", "Devis et factures."],
                ] as [keyof NotificationPreferences, string, string][]
              ).map(([key, label, description]) => (
                <label className="toggle-row" key={key}>
                  <span>
                    <b>{label}</b>
                    <small>{description}</small>
                  </span>
                  <input
                    type="checkbox"
                    checked={notifications[key]}
                    onChange={(event) =>
                      setNotifications((current) => ({ ...current, [key]: event.target.checked }))
                    }
                  />
                </label>
              ))}
            </div>

            {notificationsError && <p className="form-error" role="alert">{notificationsError}</p>}
            {notificationsSuccess && <p className="form-success" role="status">{notificationsSuccess}</p>}
            <div className="settings-actions">
              <Button onClick={saveNotifications} disabled={notificationsSaving}>
                {notificationsSaving ? "Enregistrement..." : "Enregistrer les notifications"}
              </Button>
            </div>
          </div>
        )}

        {activeTab === "preferences" && (
          <div className="settings-block">
            <header className="settings-head">
              <div>
                <h2>Preferences</h2>
                <p>Seules les options ayant un effet réel sont proposées.</p>
              </div>
            </header>

            <div className="settings-grid">
              <label className="settings-field">
                <span>Langue</span>
                <select
                  value={preferences.language}
                  onChange={(event) =>
                    setPreferences((current) => ({ ...current, language: event.target.value === "en" ? "en" : "fr" }))
                  }
                >
                  <option value="fr">Français</option>
                  <option value="en">English</option>
                </select>
                <small>
                  La langue est utilisée pour les formats de date, d&apos;heure et de nombre. La traduction
                  complète de l&apos;interface n&apos;est pas encore activée.
                </small>
              </label>
              <label className="settings-field">
                <span>Devise par défaut</span>
                <input value="TND" readOnly />
                <small>La devise de référence de FreelanceTN est le dinar tunisien.</small>
              </label>
              <label className="settings-field">
                <span>Thème</span>
                <select
                  value={preferences.theme}
                  onChange={(event) => {
                    const theme = event.target.value === "dark" ? "dark" : "light";
                    setPreferences((current) => ({ ...current, theme }));
                    applyTheme(theme);
                  }}
                >
                  <option value="light">Clair</option>
                  <option value="dark">Sombre</option>
                </select>
              </label>
              <label className="settings-field">
                <span>Fuseau horaire</span>
                <select
                  value={preferences.timezone}
                  onChange={(event) => setPreferences((current) => ({ ...current, timezone: event.target.value }))}
                >
                  {TIMEZONES.map((timezone) => (
                    <option key={timezone} value={timezone}>{timezone}</option>
                  ))}
                </select>
              </label>
              <label className="settings-field">
                <span>Format de date</span>
                <select
                  value={preferences.dateFormat}
                  onChange={(event) =>
                    setPreferences((current) => ({
                      ...current,
                      dateFormat: event.target.value === "YYYY-MM-DD" ? "YYYY-MM-DD" : "DD/MM/YYYY",
                    }))
                  }
                >
                  <option value="DD/MM/YYYY">JJ/MM/AAAA</option>
                  <option value="YYYY-MM-DD">AAAA-MM-JJ</option>
                </select>
              </label>
              <label className="settings-field">
                <span>Séparateur de milliers</span>
                <select
                  value={preferences.thousandsSeparator ? "yes" : "no"}
                  onChange={(event) =>
                    setPreferences((current) => ({ ...current, thousandsSeparator: event.target.value === "yes" }))
                  }
                >
                  <option value="yes">Activé</option>
                  <option value="no">Désactivé</option>
                </select>
              </label>
            </div>

            {preferencesError && <p className="form-error" role="alert">{preferencesError}</p>}
            {preferencesSuccess && <p className="form-success" role="status">{preferencesSuccess}</p>}
            <div className="settings-actions">
              <Button onClick={savePreferences} disabled={preferencesSaving}>
                {preferencesSaving ? "Enregistrement..." : "Enregistrer les préférences"}
              </Button>
            </div>
          </div>
        )}
      </section>

      {avatarStudioOpen && (
        <div className="modal-backdrop" onClick={() => setAvatarStudioOpen(false)}>
          <div className="auth-modal avatar-studio-popup" style={{ maxWidth: 920, width: "94vw" }} onClick={(e) => e.stopPropagation()}>
            <button className="modal-close" onClick={() => setAvatarStudioOpen(false)} aria-label="Fermer">
              <Icon name="close" />
            </button>
            <h2>Avatar Studio</h2>
            <p className="task-empty" style={{ marginTop: -4, marginBottom: 10 }}>Votre photo réelle reste affichée. L&apos;avatar personnalisé apparaît en complément et ne remplace jamais la photo.</p>
            <AvatarStudio
              initial={
                profile?.avatarConfig
                  ? (() => {
                      try {
                        return JSON.parse(profile.avatarConfig);
                      } catch {
                        return undefined;
                      }
                    })()
                  : undefined
              }
              onCancel={() => setAvatarStudioOpen(false)}
              onSave={async (config) => {
                setAvatarBusy(true);
                setAvatarError("");
                try {
                  // Save generated avatar config only; real profile photo (Avatar) is preserved.
                  const updated = await accountApi.setAvatarStyle({
                    source: "generated",
                    config: JSON.stringify(config),
                  });
                  setProfile(updated);
                  setProfileForm(profileToForm(updated));
                  await refreshUser();
                  setProfileSuccess("Avatar personnalisé enregistré. Votre photo réelle est conservée.");
                  setAvatarStudioOpen(false);
                } catch (error) {
                  setAvatarError(errorMessage(error, "L'avatar n'a pas pu être enregistré."));
                } finally {
                  setAvatarBusy(false);
                }
              }}
            />
          </div>
        </div>
      )}

      {cropTarget && (
        <ImageCropper
          target={cropTarget}
          onCancel={() => setCropTarget(null)}
          onSave={handleCropSave}
        />
      )}
    </div>
  );
}

function QrCodeImage({ value }: { value: string }) {
  const [src, setSrc] = useState("");
  useEffect(() => {
    let cancelled = false;
    QRCode.toDataURL(value, { width: 180, margin: 1 })
      .then((url: string) => {
        if (!cancelled) setSrc(url);
      })
      .catch(() => {
        if (!cancelled) setSrc("");
      });
    return () => {
      cancelled = true;
    };
  }, [value]);
  if (!src) return <div className="task-empty">Génération du QR Code…</div>;
  return <img src={src} alt="QR Code 2FA" width={180} height={180} />;
}

export default AccountSettings;
