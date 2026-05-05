import type { UserId } from "../../domain/user/user.types";
import type {
	FindCompletedOnboardingSteps,
	MarkOnboardingStepCompleted,
	OnboardingStepId,
} from "./onboarding.types";

export interface InMemoryOnboarding {
	findCompletedOnboardingSteps: FindCompletedOnboardingSteps;
	markOnboardingStepCompleted: MarkOnboardingStepCompleted;
	debugStateFor: (userId: UserId) => ReadonlyMap<OnboardingStepId, Date>;
}

export function initInMemoryOnboarding(): InMemoryOnboarding {
	const completedByUser = new Map<UserId, Map<OnboardingStepId, Date>>();

	function loadOrInit(userId: UserId): Map<OnboardingStepId, Date> {
		let row = completedByUser.get(userId);
		if (!row) {
			row = new Map<OnboardingStepId, Date>();
			completedByUser.set(userId, row);
		}
		return row;
	}

	return {
		findCompletedOnboardingSteps: async ({ userId }) => {
			const row = completedByUser.get(userId);
			return new Set(row?.keys() ?? []);
		},
		markOnboardingStepCompleted: async ({ userId, stepId, completedAt }) => {
			const row = loadOrInit(userId);
			if (!row.has(stepId)) row.set(stepId, completedAt);
		},
		debugStateFor: (userId) => completedByUser.get(userId) ?? new Map(),
	};
}
