import { ClientPublicProfile } from "@/components/views/client/ClientPublicProfile";
import { FreelancerProfileChrome } from "@/components/views/freelancer/FreelancerProfileChrome";

export default async function FreelancerClientProfilePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <FreelancerProfileChrome>
      <ClientPublicProfile clientId={id} />
    </FreelancerProfileChrome>
  );
}
