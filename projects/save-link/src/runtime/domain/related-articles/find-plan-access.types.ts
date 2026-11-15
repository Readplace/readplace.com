import type { UserId } from "@packages/domain/user";
import type { PlanAccess } from "@packages/subscription-access";

export type FindPlanAccess = (params: { userId: UserId }) => Promise<PlanAccess>;
