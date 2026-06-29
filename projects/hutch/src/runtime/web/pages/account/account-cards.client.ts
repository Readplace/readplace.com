/**
 * Glue for the inline "add a card" flow. Stripe.js itself must be served from
 * js.stripe.com for PCI SAQ-A (the raw PAN never touches our origin); this
 * same-origin bundle only reads the SetupIntent config the server rendered into
 * the Elements container's data-* attributes, mounts the Card Element, and
 * confirms the SetupIntent. On success it navigates back to /account, where the
 * live read shows the new card as a backup.
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
}

const GENERIC_ERROR = "We couldn't save your card. Please try again.";

/** Read the SetupIntent config straight from the DOM the server rendered —
 * never hardcode keys in the bundle. Returns undefined when either attribute is
 * missing so the caller can no-op on list/manage renders. */
export function readElementsConfig(container: Element): ElementsConfig | undefined {
	const publishableKey = container.getAttribute("data-publishable-key");
	const clientSecret = container.getAttribute("data-client-secret");
	if (!publishableKey || !clientSecret) return undefined;
	return { publishableKey, clientSecret };
}

interface SubmitDeps {
	stripe: StripeLike;
	card: StripeElement;
	clientSecret: string;
	errorEl: Element;
	submitButton: HTMLButtonElement;
	navigate: (url: string) => void;
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
	deps.navigate("/account");
}

export interface AccountCardsDeps {
	document: Document;
	loadStripe: LoadStripe;
	navigate: (url: string) => void;
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
	container.setAttribute("data-card-mounted", "true");

	const mountPoint = container.querySelector("[data-card-element]");
	const errorEl = container.querySelector("[data-card-error]");
	const submitButton = container.querySelector<HTMLButtonElement>("[data-card-submit]");
	if (!mountPoint || !errorEl || !submitButton) return;

	const stripe = await deps.loadStripe(config.publishableKey);
	const card = stripe.elements().create("card");
	card.mount(mountPoint);

	submitButton.addEventListener("click", () => {
		void confirmSetup({
			stripe,
			card,
			clientSecret: config.clientSecret,
			errorEl,
			submitButton,
			navigate: deps.navigate,
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
