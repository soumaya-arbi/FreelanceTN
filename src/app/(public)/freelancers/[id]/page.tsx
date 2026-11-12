import { ProfileRoute } from "@/components/views/ProfileRoute";

export default async function FreelancerProfilePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ProfileRoute freelancerId={id} />;
}
