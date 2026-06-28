import type { UserId } from "@packages/domain/user";
import type {
	GetIosAppSignals,
	RecordIosAnyActivity,
	RecordIosSavedArticle,
} from "@packages/provider-contracts/ios-onboarding-signal";

export function initInMemoryIosOnboardingSignal(): {
	recordIosAnyActivity: RecordIosAnyActivity;
	recordIosSavedArticle: RecordIosSavedArticle;
	getIosAppSignals: GetIosAppSignals;
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

	return { recordIosAnyActivity, recordIosSavedArticle, getIosAppSignals };
}
