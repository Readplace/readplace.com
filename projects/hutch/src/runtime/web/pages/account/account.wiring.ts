import { Logger } from "@packages/logger";
import type { AppDependencies } from "../../../server";
import { ignoreLogLine } from "../../ignore-log-line";
import type { initAccountRoutes } from "./account.page";

export function accountDependenciesFrom(
	deps: Pick<AppDependencies, "subscriptionProviders" | "findEmailByUserId" | "findUserById" | "findUserPasswordStatus" | "setUserAppearance" | "setUserDisplayName" | "destroyUserSessions" | "revokeAllUserOAuthTokens" | "revokeUserOAuthClient" | "markAccountDeleted" | "publishDeleteAccountCommand" | "publishCancelSubscriptionCommand" | "publishSubscriptionReactivated" | "createCheckoutSession" | "createSubscriptionOnExistingCustomer" | "findSubscriptionNextCharge" | "listInvoices" | "reverseScheduledCancellation" | "paymentMethods" | "stripePublishableKey" | "trialScheduler" | "storePendingSignup" | "resolvePriceId" | "keepOfferCouponId" | "salt" | "logError" | "now">,
	built: Pick<
		Parameters<typeof initAccountRoutes>[0],
		"keepOffer" | "getEffectiveAccess" | "listConnectedOAuthClients" | "appOrigin" | "buildBannerState" | "recordSubscriptionEvent" | "recordAnalyticsEvent"
	>,
): Parameters<typeof initAccountRoutes>[0] {
	const {
		keepOffer,
		getEffectiveAccess,
		listConnectedOAuthClients,
		appOrigin,
		buildBannerState,
		recordSubscriptionEvent,
		recordAnalyticsEvent,
	} = built;
	return {
		keepOffer,
		keepOfferCouponId: deps.keepOfferCouponId,
		salt: deps.salt,
		getEffectiveAccess,
		findSubscriptionByUserId: deps.subscriptionProviders.findByUserId,
		upsertActiveSubscription: deps.subscriptionProviders.upsertActive,
		upsertTrialingSubscription: deps.subscriptionProviders.upsertTrialing,
		markActiveSubscription: deps.subscriptionProviders.markActive,
		findEmailByUserId: deps.findEmailByUserId,
		findUserById: deps.findUserById,
		findUserPasswordStatus: deps.findUserPasswordStatus,
		setUserAppearance: deps.setUserAppearance,
		setUserDisplayName: deps.setUserDisplayName,
		destroyUserSessions: deps.destroyUserSessions,
		revokeAllUserOAuthTokens: deps.revokeAllUserOAuthTokens,
		listConnectedOAuthClients,
		revokeUserOAuthClient: deps.revokeUserOAuthClient,
		markAccountDeleted: deps.markAccountDeleted,
		publishDeleteAccountCommand: deps.publishDeleteAccountCommand,
		publishCancelSubscriptionCommand: deps.publishCancelSubscriptionCommand,
		publishSubscriptionReactivated: deps.publishSubscriptionReactivated,
		createCheckoutSession: deps.createCheckoutSession,
		createSubscriptionOnExistingCustomer: deps.createSubscriptionOnExistingCustomer,
		findSubscriptionNextCharge: deps.findSubscriptionNextCharge,
		listInvoices: deps.listInvoices,
		setSubscriptionNextCharge: deps.subscriptionProviders.setNextCharge,
		reverseScheduledCancellation: deps.reverseScheduledCancellation,
		listCards: deps.paymentMethods.listCards,
		beginAddCard: deps.paymentMethods.beginAddCard,
		getCardSetupResult: deps.paymentMethods.getCardSetupResult,
		removeCard: deps.paymentMethods.removeCard,
		setPrimaryCard: deps.paymentMethods.setPrimaryCard,
		stripePublishableKey: deps.stripePublishableKey,
		trialScheduler: deps.trialScheduler,
		createChargeReminderSchedule: deps.trialScheduler.createChargeReminderSchedule,
		deleteDeferredCancellationSchedule:
			deps.trialScheduler.deleteDeferredCancellationSchedule,
		storePendingSignup: deps.storePendingSignup,
		resolvePriceId: deps.resolvePriceId,
		buildCheckoutSuccessUrl: (sessionIdPlaceholder) =>
			`${appOrigin}/auth/checkout/success?session_id=${sessionIdPlaceholder}`,
		appOrigin,
		logger: Logger.from({
			info: ignoreLogLine,
			error: (...args) => {
				deps.logError(String(args[0]), args[1] instanceof Error ? args[1] : undefined);
			},
			warn: ignoreLogLine,
			debug: ignoreLogLine,
		}),
		now: deps.now,
		buildBannerState,
		recordSubscriptionEvent,
		recordAnalyticsEvent,
	};
}
