import type { UserId } from "@packages/domain/user";
import type {
	StripeSubscriptionStatus,
	StripeSubscriptionSummary,
} from "@packages/provider-contracts/subscription-billing";
import type {
	SubscriptionRecord,
	SubscriptionStatus,
} from "@packages/provider-contracts/subscription-providers";

export function maskEmail(email: string): string {
	const [local, domain] = email.split("@");
	if (!local || !domain) return "***";
	return `${local[0]}***@${domain[0]}***`;
}

/** Statuses under which Stripe still considers a subscription entitled or
 * payment-attempting — everything except the two terminal-dead ones
 * (canceled, incomplete_expired). */
const LIVE_STRIPE_STATUSES: ReadonlySet<StripeSubscriptionStatus> = new Set([
	"incomplete",
	"trialing",
	"active",
	"past_due",
	"unpaid",
	"paused",
]);

export type ReconcileFindings = {
	stripeSubsMissingAppRow: {
		subscriptionId: string;
		customerId: string;
		stripeStatus: StripeSubscriptionStatus;
		maskedCustomerEmail?: string;
	}[];
	liveAppRowsMissingLiveStripeSub: {
		userId: UserId;
		status: "active" | "pending_cancellation";
		subscriptionId?: string;
	}[];
	liveStripeSubsWithCancelledAppRow: {
		subscriptionId: string;
		userId: UserId;
		appStatus: SubscriptionStatus;
		stripeStatus: StripeSubscriptionStatus;
	}[];
	trialingRowsPastTrialEnd: { userId: UserId; trialEndsAt?: string }[];
	rowsMissingSubscriptionId: { userId: UserId; status: SubscriptionStatus }[];
};

export function reconcile(params: {
	now: Date;
	appRows: SubscriptionRecord[];
	stripeSubs: StripeSubscriptionSummary[];
}): ReconcileFindings {
	const { now, appRows, stripeSubs } = params;

	const appBySubscriptionId = new Map<string, SubscriptionRecord>();
	for (const row of appRows) {
		if (row.subscriptionId !== undefined) appBySubscriptionId.set(row.subscriptionId, row);
	}
	const stripeBySubscriptionId = new Map<string, StripeSubscriptionSummary>();
	for (const sub of stripeSubs) stripeBySubscriptionId.set(sub.subscriptionId, sub);

	const stripeSubsMissingAppRow: ReconcileFindings["stripeSubsMissingAppRow"] = [];
	for (const sub of stripeSubs) {
		if (appBySubscriptionId.has(sub.subscriptionId)) continue;
		stripeSubsMissingAppRow.push({
			subscriptionId: sub.subscriptionId,
			customerId: sub.customerId,
			stripeStatus: sub.status,
			...(sub.customerEmail ? { maskedCustomerEmail: maskEmail(sub.customerEmail) } : {}),
		});
	}

	const liveAppRowsMissingLiveStripeSub: ReconcileFindings["liveAppRowsMissingLiveStripeSub"] = [];
	for (const row of appRows) {
		if (row.status !== "active" && row.status !== "pending_cancellation") continue;
		const matched =
			row.subscriptionId !== undefined
				? stripeBySubscriptionId.get(row.subscriptionId)
				: undefined;
		if (!matched || !LIVE_STRIPE_STATUSES.has(matched.status)) {
			liveAppRowsMissingLiveStripeSub.push({
				userId: row.userId,
				status: row.status,
				...(row.subscriptionId !== undefined ? { subscriptionId: row.subscriptionId } : {}),
			});
		}
	}

	const liveStripeSubsWithCancelledAppRow: ReconcileFindings["liveStripeSubsWithCancelledAppRow"] =
		[];
	for (const sub of stripeSubs) {
		if (!LIVE_STRIPE_STATUSES.has(sub.status)) continue;
		const matched = appBySubscriptionId.get(sub.subscriptionId);
		if (matched && matched.status === "cancelled") {
			liveStripeSubsWithCancelledAppRow.push({
				subscriptionId: sub.subscriptionId,
				userId: matched.userId,
				appStatus: matched.status,
				stripeStatus: sub.status,
			});
		}
	}

	const trialingRowsPastTrialEnd: ReconcileFindings["trialingRowsPastTrialEnd"] = [];
	for (const row of appRows) {
		if (row.status !== "trialing") continue;
		const expired =
			row.trialEndsAt === undefined || Date.parse(row.trialEndsAt) < now.getTime();
		if (expired) {
			trialingRowsPastTrialEnd.push({
				userId: row.userId,
				...(row.trialEndsAt !== undefined ? { trialEndsAt: row.trialEndsAt } : {}),
			});
		}
	}

	const rowsMissingSubscriptionId: ReconcileFindings["rowsMissingSubscriptionId"] = [];
	for (const row of appRows) {
		if (row.subscriptionId === undefined) {
			rowsMissingSubscriptionId.push({ userId: row.userId, status: row.status });
		}
	}

	return {
		stripeSubsMissingAppRow,
		liveAppRowsMissingLiveStripeSub,
		liveStripeSubsWithCancelledAppRow,
		trialingRowsPastTrialEnd,
		rowsMissingSubscriptionId,
	};
}

export function formatReconcileReport(findings: ReconcileFindings): string[] {
	const lines: string[] = ["[stripe-reconcile] report (read-only, no writes)"];

	lines.push(`Stripe subs with no matching app row: ${findings.stripeSubsMissingAppRow.length}`);
	for (const entry of findings.stripeSubsMissingAppRow) {
		lines.push(
			`  sub=${entry.subscriptionId} customer=${entry.customerId} stripeStatus=${entry.stripeStatus} email=${entry.maskedCustomerEmail ?? "(none)"}`,
		);
	}

	lines.push(
		`Live app rows with no live Stripe sub: ${findings.liveAppRowsMissingLiveStripeSub.length}`,
	);
	for (const entry of findings.liveAppRowsMissingLiveStripeSub) {
		lines.push(
			`  userId=${entry.userId} status=${entry.status} subscriptionId=${entry.subscriptionId ?? "(none)"}`,
		);
	}

	lines.push(
		`Live Stripe subs with cancelled app row: ${findings.liveStripeSubsWithCancelledAppRow.length}`,
	);
	for (const entry of findings.liveStripeSubsWithCancelledAppRow) {
		lines.push(
			`  sub=${entry.subscriptionId} userId=${entry.userId} appStatus=${entry.appStatus} stripeStatus=${entry.stripeStatus}`,
		);
	}

	lines.push(`Trialing rows past trial end: ${findings.trialingRowsPastTrialEnd.length}`);
	for (const entry of findings.trialingRowsPastTrialEnd) {
		lines.push(`  userId=${entry.userId} trialEndsAt=${entry.trialEndsAt ?? "(none)"}`);
	}

	lines.push(`Rows missing subscriptionId: ${findings.rowsMissingSubscriptionId.length}`);
	for (const entry of findings.rowsMissingSubscriptionId) {
		lines.push(`  userId=${entry.userId} status=${entry.status}`);
	}

	lines.push(
		`[stripe-reconcile] summary: stripeSubsMissingAppRow=${findings.stripeSubsMissingAppRow.length} liveAppRowsMissingLiveStripeSub=${findings.liveAppRowsMissingLiveStripeSub.length} liveStripeSubsWithCancelledAppRow=${findings.liveStripeSubsWithCancelledAppRow.length} trialingRowsPastTrialEnd=${findings.trialingRowsPastTrialEnd.length} rowsMissingSubscriptionId=${findings.rowsMissingSubscriptionId.length}`,
	);

	return lines;
}
