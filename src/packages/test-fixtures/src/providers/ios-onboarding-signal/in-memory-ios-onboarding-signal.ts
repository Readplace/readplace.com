import type { UserId } from "@packages/domain/user";
import type {
	DeleteOnboarding,
	GetIosAppSignals,
	RecordIosAnyActivity,
	RecordIosSavedArticle,
} from "@packages/provider-contracts/ios-onboarding-signal";

export function initInMemoryIosOnboardingSignal(): {
	recordIosAnyActivity: RecordIosAnyActivity;
	recordIosSavedArticle: RecordIosSavedArticle;
	getIosAppSignals: GetIosAppSignals;
	deleteOnboarding: DeleteOnboarding;
} {
	const activated = new Set<UserId>();
	const saved = new Set<UserId>();

	const recordIosAnyActivity: RecordIosAnyActivity = async ({ userId }) => {
		activated.add(userId);
	};

	const recordIosSavedArticle: RecordIosSavedArticle = async ({ userId }) => {
		activated.add(userId);
		saved.add(userId);
	};

	const getIosAppSignals: GetIosAppSignals = async ({ userId }) => ({
		installed: activated.has(userId),
		savedArticle: saved.has(userId),
	});

	const deleteOnboarding: DeleteOnboarding = async ({ userId }) => {
		activated.delete(userId);
		saved.delete(userId);
	};

	return { recordIosAnyActivity, recordIosSavedArticle, getIosAppSignals, deleteOnboarding };
}
