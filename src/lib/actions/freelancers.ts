"use server";

import type { ActionResult } from "@/lib/actions/types";
import { runAction } from "@/lib/server/errors";
import { serialize } from "@/lib/server/serialize";
import * as freelancerService from "@/lib/server/services/freelancers";
import type {
  PublicFreelancer,
  PublicFreelancerSummary,
} from "@/lib/server/services/freelancers";

export async function listFreelancers(): Promise<ActionResult<PublicFreelancerSummary[]>> {
  return runAction(
    async () => serialize(await freelancerService.listFreelancers()) as PublicFreelancerSummary[],
  );
}

export async function getFreelancer(id: string): Promise<ActionResult<PublicFreelancer>> {
  return runAction(
    async () => serialize(await freelancerService.getFreelancer(id)) as PublicFreelancer,
  );
}
