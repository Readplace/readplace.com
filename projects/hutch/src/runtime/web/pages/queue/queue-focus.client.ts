/**
 * Keeps the keyboard focus somewhere useful when a card-scoped mutation removes
 * the card the user just acted on. Without this, activating "Mark as read" or
 * Delete with the keyboard would drop focus to the document body once the card
 * (and the button inside it) leaves the DOM. Only fires when focus was inside
 * the removed card, so a mouse user sees no focus jump. Dependencies are
 * injected so the browser wiring stays out of this module and it stays
 * unit-testable.
 */
export interface QueueFocusDeps {
	document: Document;
	/** Fires with the element htmx is about to swap, for every swap. */
	addBeforeSwapListener: (listener: (target: Element) => void) => void;
	/** Fires after htmx settles a swap (main and out-of-band both done). */
	addAfterSettleListener: (listener: () => void) => void;
}

function isQueueArticle(element: Element | null): element is Element {
	return element?.matches(".queue-article") ?? false;
}

function adjacentCard(card: Element): Element | null {
	const next = card.nextElementSibling;
	if (isQueueArticle(next)) return next;
	const prev = card.previousElementSibling;
	return isQueueArticle(prev) ? prev : null;
}

/** Priority order once a focused card is removed: the toast's Undo (a status
 * change puts keyboard users one keypress from reversing it), else the adjacent
 * card's first action, else the always-present save input. */
function firstFocusTarget(document: Document, adjacent: Element | null): HTMLElement | null {
	const toastAction = document.querySelector<HTMLElement>(".toast__action");
	if (toastAction) return toastAction;
	if (adjacent?.isConnected) {
		const btn = adjacent.querySelector<HTMLElement>(".queue-article__action-btn");
		if (btn) return btn;
	}
	return document.querySelector<HTMLElement>(".queue__save-input");
}

export function initQueueFocus(deps: QueueFocusDeps): void {
	/** The card adjacent to the one being removed, remembered on beforeSwap and
	 * focused after the swap settles. `armed` gates the settle handler so it acts
	 * only for a swap that removed the focused card, not for counts/poll swaps. */
	let adjacentToRemoved: Element | null = null;
	let armed = false;

	deps.addBeforeSwapListener((target) => {
		if (!isQueueArticle(target)) return;
		if (!target.contains(deps.document.activeElement)) return;
		adjacentToRemoved = adjacentCard(target);
		armed = true;
	});

	deps.addAfterSettleListener(() => {
		if (!armed) return;
		const adjacent = adjacentToRemoved;
		armed = false;
		adjacentToRemoved = null;
		const target = firstFocusTarget(deps.document, adjacent);
		if (target) target.focus();
	});
}
