/**
 * Stripe.js must be served from js.stripe.com for PCI SAQ-A — the raw PAN
 * never touches our origin, so this same-origin bundle only handles the config
 * the server rendered into the Elements container's data-* attributes.
 */

interface StripeElement {
	mount(target: Element): void;
}

interface StripeElements {
	create(type: string): StripeElement;
}

interface StripeConfirmResult {
	error?: { message?: string };
}

interface StripeLike {
	elements(): StripeElements;
	confirmCardSetup(
		clientSecret: string,
		data: { payment_method: { card: StripeElement } },
	): Promise<StripeConfirmResult>;
}

export type LoadStripe = (publishableKey: string) => Promise<StripeLike>;

export interface ElementsConfig {
	publishableKey: string;
	clientSecret: string;
	setupId: string;
}

const GENERIC_ERROR = "We couldn't save your card. Please try again.";
const STRIPE_LOAD_ERROR =
	"We couldn't load the secure card form. Check your connection or ad blocker, then reload to try again.";

/** Read the SetupIntent config straight from the DOM the server rendered —
 * never hardcode keys in the bundle. Returns undefined when any attribute is
 * missing so the caller can no-op on list/manage renders. */
export function readElementsConfig(container: Element): ElementsConfig | undefined {
	const publishableKey = container.getAttribute("data-publishable-key");
	const clientSecret = container.getAttribute("data-client-secret");
	const setupId = container.getAttribute("data-setup-id");
	if (!publishableKey || !clientSecret || !setupId) return undefined;
	return { publishableKey, clientSecret, setupId };
}

interface SubmitDeps {
	stripe: StripeLike;
	card: StripeElement;
	clientSecret: string;
	setupId: string;
	errorEl: Element;
	submitButton: HTMLButtonElement;
	confirmAdd: (input: { setupId: string }) => void;
}

export async function confirmSetup(deps: SubmitDeps): Promise<void> {
	deps.submitButton.disabled = true;
	deps.errorEl.textContent = "";
	const result = await deps.stripe.confirmCardSetup(deps.clientSecret, {
		payment_method: { card: deps.card },
	});
	if (result.error) {
		deps.errorEl.textContent = result.error.message ?? GENERIC_ERROR;
		deps.submitButton.disabled = false;
		return;
	}
	deps.confirmAdd({ setupId: deps.setupId });
}

export interface AccountCardsDeps {
	document: Document;
	loadStripe: LoadStripe;
	confirmAdd: (input: { setupId: string }) => void;
	addSettleListener: (listener: () => void) => void;
}

export async function mountElements(deps: AccountCardsDeps): Promise<void> {
	const container = deps.document.querySelector("[data-card-elements]");
	if (!container) return;
	const config = readElementsConfig(container);
	if (!config) return;
	// HTMX can re-run this after a settle on a container that is already live;
	// guard so we mount exactly once per container instance.
	if (container.getAttribute("data-card-mounted") === "true") return;

	const mountPoint = container.querySelector("[data-card-element]");
	const errorEl = container.querySelector("[data-card-error]");
	const submitButton = container.querySelector<HTMLButtonElement>("[data-card-submit]");
	if (!mountPoint || !errorEl || !submitButton) return;

	let stripe: StripeLike;
	try {
		stripe = await deps.loadStripe(config.publishableKey);
	} catch {
		// Stripe.js failed to load (offline, blocked by an extension). Surface a
		// retryable message and leave data-card-mounted unset so the next
		// htmx:afterSettle — or a manual reload — can attempt the mount again.
		errorEl.textContent = STRIPE_LOAD_ERROR;
		return;
	}
	// Mark mounted only after a successful load so a transient failure stays retryable.
	container.setAttribute("data-card-mounted", "true");

	const card = stripe.elements().create("card");
	card.mount(mountPoint);

	submitButton.addEventListener("click", () => {
		void confirmSetup({
			stripe,
			card,
			clientSecret: config.clientSecret,
			setupId: config.setupId,
			errorEl,
			submitButton,
			confirmAdd: deps.confirmAdd,
		});
	});
}

export function initAccountCards(deps: AccountCardsDeps): void {
	const run = (): void => {
		void mountElements(deps);
	};
	deps.addSettleListener(run);
	run();
}
