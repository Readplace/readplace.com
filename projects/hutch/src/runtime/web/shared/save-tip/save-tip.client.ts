export interface SaveTipDeps {
	document: Document;
	supportsPopover: () => boolean;
	showPopover: (panel: Element) => void;
	hidePopover: (panel: Element) => void;
	navigate: (href: string) => void;
}

/** What the visitor asked for and the panel is holding back: a form waiting to
 * submit, or a link waiting to be followed. The panel travels with it so the
 * proceed control never has to look one up that may not be there. */
type PendingSave = { panel: Element } & (
	| { form: HTMLFormElement; href?: undefined }
	| { href: string; form?: undefined }
);

const PANEL_ID = "save-tip";
const DUE_SELECTOR = "[data-save-tip='due']";
const PROCEED_SELECTOR = "[data-save-tip-proceed]";
const CONFIRMED_FLAG = "data-save-tip-confirmed";

function isElement(node: EventTarget | null): node is Element {
	return typeof Reflect.get(Object(node), "closest") === "function";
}

export function initSaveTip(deps: SaveTipDeps): void {
	let pending: PendingSave | null = null;

	function openablePanel(): Element | null {
		if (!deps.supportsPopover()) return null;
		return deps.document.getElementById(PANEL_ID);
	}

	deps.document.addEventListener("submit", (event) => {
		const target = event.target;
		if (!isElement(target)) return;
		const form = target.closest<HTMLFormElement>(DUE_SELECTOR);
		if (form === null) return;
		// Set by the proceed control below, so the resubmit it asks for passes
		// straight through instead of reopening the panel it came from.
		if (form.hasAttribute(CONFIRMED_FLAG)) return;
		const panel = openablePanel();
		if (panel === null) return;
		event.preventDefault();
		pending = { panel, form };
		deps.showPopover(panel);
	});

	deps.document.addEventListener("click", (event) => {
		const target = event.target;
		if (!isElement(target)) return;

		if (target.closest(PROCEED_SELECTOR) !== null) {
			const accepted = pending;
			pending = null;
			if (accepted === null) return;
			deps.hidePopover(accepted.panel);
			if (accepted.form !== undefined) {
				accepted.form.setAttribute(CONFIRMED_FLAG, "true");
				accepted.form.requestSubmit();
				return;
			}
			deps.navigate(accepted.href);
			return;
		}

		if (event.defaultPrevented) return;
		if (event.button !== 0) return;
		if ([event.metaKey, event.ctrlKey, event.shiftKey, event.altKey].includes(true)) return;
		const link = target.closest<HTMLAnchorElement>(`a${DUE_SELECTOR}`);
		if (link === null) return;
		const panel = openablePanel();
		if (panel === null) return;
		event.preventDefault();
		pending = { panel, href: link.href };
		deps.showPopover(panel);
	});
}
