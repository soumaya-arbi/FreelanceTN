"use server";

import type { ActionResult } from "@/lib/actions/types";
import { runAction } from "@/lib/server/errors";
import { revalidateApp } from "@/lib/server/revalidate";
import { getSessionUser, requireUser } from "@/lib/server/session";
import { serialize } from "@/lib/server/serialize";
import * as portfolioService from "@/lib/server/services/portfolio";
import type { PortfolioItemResponse } from "@/lib/server/services/portfolio";

export async function listMyPortfolio(): Promise<ActionResult<PortfolioItemResponse[]>> {
  return runAction(async () => {
    const user = await requireUser();
    return serialize(
      await portfolioService.listMyPortfolio(user),
    ) as PortfolioItemResponse[];
  });
}

export async function listFreelancerPortfolio(
  freelancerId: string,
): Promise<ActionResult<PortfolioItemResponse[]>> {
  return runAction(async () => {
    const user = await getSessionUser();
    const isClient = user?.role === "client";
    return serialize(
      await portfolioService.listFreelancerPortfolio(freelancerId, isClient),
    ) as PortfolioItemResponse[];
  });
}

export async function getPortfolioItem(
  id: string,
): Promise<ActionResult<PortfolioItemResponse>> {
  return runAction(async () => {
    const user = await getSessionUser();
    return serialize(
      await portfolioService.getPortfolioItem(user, id),
    ) as PortfolioItemResponse;
  });
}

export async function createPortfolioItem(
  input: Record<string, unknown>,
): Promise<ActionResult<PortfolioItemResponse>> {
  return runAction(async () => {
    const user = await requireUser();
    const item = await portfolioService.createPortfolioItem(user, input);
    revalidateApp();
    return serialize(item) as PortfolioItemResponse;
  });
}

export async function updatePortfolioItem(
  id: string,
  input: Record<string, unknown>,
): Promise<ActionResult<PortfolioItemResponse>> {
  return runAction(async () => {
    const user = await requireUser();
    const item = await portfolioService.updatePortfolioItem(user, id, input);
    revalidateApp();
    return serialize(item) as PortfolioItemResponse;
  });
}

export async function deletePortfolioItem(id: string): Promise<ActionResult<null>> {
  return runAction(async () => {
    const user = await requireUser();
    await portfolioService.deletePortfolioItem(user, id);
    revalidateApp();
    return serialize(null) as null;
  });
}
