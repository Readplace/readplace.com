import type { UserId } from "@packages/domain/user";
import type {
	GetIosAppSignals,
	RecordIosAppActivity,
} from "@packages/provider-contracts/ios-onboarding-signal";

export function initInMemoryIosOnboardingSignal(): {
	recordIosAppActivity: RecordIosAppActivity;
	getIosAppSignals: GetIosAppSignals;
} {
	const activated = new Set<UserId>();
	const saved = new Set<UserId>();

	const recordIosAppActivity: RecordIosAppActivity = async ({ userId, savedArticle }) => {
		activated.add(userId);
		if (savedArticle) saved.add(userId);
	};

	const getIosAppSignals: GetIosAppSignals = async ({ userId }) => ({
		installed: activated.has(userId),
		savedArticle: saved.has(userId),
	});

	return { recordIosAppActivity, getIosAppSignals };
}
