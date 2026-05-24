import { randomBytes } from "node:crypto";
import { CheckoutSessionIdSchema } from "./stripe-checkout.schema";
import type {
	CheckoutSessionId,
	CheckoutSessionStatus,
	CreateCheckoutSession,
	RetrieveCheckoutSession,
} from "./stripe-checkout.types";

interface StoredSession {
	customerEmail: string;
	paid: boolean;
	status: CheckoutSessionStatus;
	created: number;
	subscriptionId: string;
	customerId: string;
}

export function initInMemoryStripeCheckout(opts: {
	checkoutBaseUrl: string;
	now: () => Date;
}): {
	createCheckoutSession: CreateCheckoutSession;
	retrieveCheckoutSession: RetrieveCheckoutSession;
	markPaid: (id: CheckoutSessionId) => void;
	markExpired: (id: CheckoutSessionId) => void;
	getCheckoutUrl: (id: CheckoutSessionId) => string;
} {
	const sessions = new Map<CheckoutSessionId, StoredSession>();
	const urls = new Map<CheckoutSessionId, string>();

	const createCheckoutSession: CreateCheckoutSession = async ({ customerEmail, successUrl }) => {
		const id = CheckoutSessionIdSchema.parse(`cs_test_${randomBytes(12).toString("hex")}`);
		const sessionSuffix = randomBytes(8).toString("hex");
		sessions.set(id, {
			customerEmail,
			paid: false,
			status: "open",
			created: Math.floor(opts.now().getTime() / 1000),
			subscriptionId: `sub_test_${sessionSuffix}`,
			customerId: `cus_test_${sessionSuffix}`,
		});
		const url = `${opts.checkoutBaseUrl}/${id}?next=${encodeURIComponent(successUrl)}`;
		urls.set(id, url);
		return { id, url };
	};

	const retrieveCheckoutSession: RetrieveCheckoutSession = async (id) => {
		const session = sessions.get(id);
		if (!session) return { ok: false, reason: "not-found" };
		return {
			ok: true,
			paid: session.paid,
			customerEmail: session.customerEmail,
			status: session.status,
			created: session.created,
			subscriptionId: session.subscriptionId,
			customerId: session.customerId,
		};
	};

	const markPaid = (id: CheckoutSessionId) => {
		const session = sessions.get(id);
		if (!session) throw new Error(`No checkout session: ${id}`);
		session.paid = true;
		session.status = "complete";
	};

	const markExpired = (id: CheckoutSessionId) => {
		const session = sessions.get(id);
		if (!session) throw new Error(`No checkout session: ${id}`);
		session.status = "expired";
	};

	const getCheckoutUrl = (id: CheckoutSessionId): string => {
		const url = urls.get(id);
		if (!url) throw new Error(`No checkout URL: ${id}`);
		return url;
	};

	return { createCheckoutSession, retrieveCheckoutSession, markPaid, markExpired, getCheckoutUrl };
}
