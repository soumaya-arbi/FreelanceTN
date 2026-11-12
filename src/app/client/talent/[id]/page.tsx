import { ProfileRoute } from "@/components/views/ProfileRoute";
import { ClientProfileChrome } from "@/components/views/client/ClientProfileChrome";

export default async function ClientTalentProfilePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <ClientProfileChrome>
      <ProfileRoute freelancerId={id} />
    </ClientProfileChrome>
  );
}
