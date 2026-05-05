import type { UserId } from "../../domain/user/user.types";

export type OnboardingStepId = "install-extension" | "save-via-extension";

export type FindCompletedOnboardingSteps = (params: {
	userId: UserId;
}) => Promise<ReadonlySet<OnboardingStepId>>;

export type MarkOnboardingStepCompleted = (params: {
	userId: UserId;
	stepId: OnboardingStepId;
	completedAt: Date;
}) => Promise<void>;
