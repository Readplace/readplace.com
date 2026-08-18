import type { UserId } from "@packages/domain/user";
import type {
	DeleteOnboarding,
	GetOnboardingSignals,
	RecordIosAnyActivity,
	RecordIosSavedArticle,
	RecordNextReadMinimumReached,
	RecordNextReadStepOutstanding,
} from "@packages/provider-contracts/onboarding-signals";

export function initInMemoryOnboardingSignals(deps: { now: () => Date }): {
	recordIosAnyActivity: RecordIosAnyActivity;
	recordIosSavedArticle: RecordIosSavedArticle;
	recordNextReadMinimumReached: RecordNextReadMinimumReached;
	recordNextReadStepOutstanding: RecordNextReadStepOutstanding;
	getOnboardingSignals: GetOnboardingSignals;
	deleteOnboarding: DeleteOnboarding;
} {
	const activated = new Set<UserId>();
	const saved = new Set<UserId>();
	const nextReadMinimumReached = new Map<UserId, Date>();
	const nextReadStepOutstanding = new Map<UserId, Date>();

	const recordIosAnyActivity: RecordIosAnyActivity = async ({ userId }) => {
		activated.add(userId);
	};

	const recordIosSavedArticle: RecordIosSavedArticle = async ({ userId }) => {
		activated.add(userId);
		saved.add(userId);
	};

	const recordNextReadMinimumReached: RecordNextReadMinimumReached = async ({
		userId,
	}) => {
		if (nextReadMinimumReached.has(userId)) return;
		nextReadMinimumReached.set(userId, deps.now());
	};

	const recordNextReadStepOutstanding: RecordNextReadStepOutstanding = async ({
		userId,
	}) => {
		if (nextReadStepOutstanding.has(userId)) return;
		nextReadStepOutstanding.set(userId, deps.now());
	};

	const getOnboardingSignals: GetOnboardingSignals = async ({ userId }) => ({
		installed: activated.has(userId),
		savedArticle: saved.has(userId),
		nextReadMinimumReachedAt: nextReadMinimumReached.get(userId),
		nextReadStepOutstandingAt: nextReadStepOutstanding.get(userId),
	});

	const deleteOnboarding: DeleteOnboarding = async ({ userId }) => {
		activated.delete(userId);
		saved.delete(userId);
		nextReadMinimumReached.delete(userId);
		nextReadStepOutstanding.delete(userId);
	};

	return {
		recordIosAnyActivity,
		recordIosSavedArticle,
		recordNextReadMinimumReached,
		recordNextReadStepOutstanding,
		getOnboardingSignals,
		deleteOnboarding,
	};
}
