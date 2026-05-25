import { randomBytes } from "node:crypto";
import { CheckoutSessionIdSchema } from "./stripe-checkout.schema";
import type {
	CheckoutSessionId,
	CheckoutSessionStatus,
	CreateCheckoutSession,
	CreateSetupCheckoutSession,
	RetrieveCheckoutSession,
	RetrieveSetupCheckoutSession,
} from "./stripe-checkout.types";

interface StoredSession {
	mode: "subscription";
	customerEmail: string;
	paid: boolean;
	status: CheckoutSessionStatus;
	created: number;
	subscriptionId: string;
	customerId: string;
}

interface StoredSetupSession {
	mode: "setup";
	status: CheckoutSessionStatus;
	customerId: string;
	paymentMethodId: string;
	brand: string;
	last4: string;
}

type AnyStoredSession = StoredSession | StoredSetupSession;

export function initInMemoryStripeCheckout(opts: {
	checkoutBaseUrl: string;
	now: () => Date;
}): {
	createCheckoutSession: CreateCheckoutSession;
	createSetupCheckoutSession: CreateSetupCheckoutSession;
	retrieveCheckoutSession: RetrieveCheckoutSession;
	retrieveSetupCheckoutSession: RetrieveSetupCheckoutSession;
	markPaid: (id: CheckoutSessionId) => void;
	markSetupComplete: (
		id: CheckoutSessionId,
		input?: { paymentMethodId?: string; brand?: string; last4?: string },
	) => void;
	markExpired: (id: CheckoutSessionId) => void;
	getCheckoutUrl: (id: CheckoutSessionId) => string;
} {
	const sessions = new Map<CheckoutSessionId, AnyStoredSession>();
	const urls = new Map<CheckoutSessionId, string>();

	const createCheckoutSession: CreateCheckoutSession = async ({ customerEmail, successUrl }) => {
		const id = CheckoutSessionIdSchema.parse(`cs_test_${randomBytes(12).toString("hex")}`);
		const sessionSuffix = randomBytes(8).toString("hex");
		sessions.set(id, {
			mode: "subscription",
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

	const createSetupCheckoutSession: CreateSetupCheckoutSession = async ({ customerId, successUrl }) => {
		const id = CheckoutSessionIdSchema.parse(`cs_setup_${randomBytes(12).toString("hex")}`);
		const sessionSuffix = randomBytes(8).toString("hex");
		sessions.set(id, {
			mode: "setup",
			status: "open",
			customerId,
			paymentMethodId: `pm_test_${sessionSuffix}`,
			brand: "visa",
			last4: "4242",
		});
		const url = `${opts.checkoutBaseUrl}/setup/${id}?next=${encodeURIComponent(successUrl)}`;
		urls.set(id, url);
		return { id, url };
	};

	const retrieveCheckoutSession: RetrieveCheckoutSession = async (id) => {
		const session = sessions.get(id);
		if (!session) return { ok: false, reason: "not-found" };
		if (session.mode !== "subscription") return { ok: false, reason: "not-found" };
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

	const retrieveSetupCheckoutSession: RetrieveSetupCheckoutSession = async (id) => {
		const session = sessions.get(id);
		if (!session) return { ok: false, reason: "not-found" };
		if (session.mode !== "setup") return { ok: false, reason: "not-found" };
		if (session.status !== "complete") return { ok: false, reason: "not-complete" };
		return {
			ok: true,
			status: session.status,
			customerId: session.customerId,
			paymentMethodId: session.paymentMethodId,
			brand: session.brand,
			last4: session.last4,
		};
	};

	const markPaid = (id: CheckoutSessionId) => {
		const session = sessions.get(id);
		if (!session) throw new Error(`No checkout session: ${id}`);
		if (session.mode !== "subscription") throw new Error(`Checkout session ${id} is not in subscription mode`);
		session.paid = true;
		session.status = "complete";
	};

	const markSetupComplete = (
		id: CheckoutSessionId,
		input?: { paymentMethodId?: string; brand?: string; last4?: string },
	) => {
		const session = sessions.get(id);
		if (!session) throw new Error(`No checkout session: ${id}`);
		if (session.mode !== "setup") throw new Error(`Checkout session ${id} is not in setup mode`);
		session.status = "complete";
		if (input?.paymentMethodId) session.paymentMethodId = input.paymentMethodId;
		if (input?.brand) session.brand = input.brand;
		if (input?.last4) session.last4 = input.last4;
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

	return {
		createCheckoutSession,
		createSetupCheckoutSession,
		retrieveCheckoutSession,
		retrieveSetupCheckoutSession,
		markPaid,
		markSetupComplete,
		markExpired,
		getCheckoutUrl,
	};
}
