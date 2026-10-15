export interface AccountDialogsDeps {
	document: Document;
}

function isElement(node: EventTarget | null): node is Element {
	return typeof Reflect.get(Object(node), "closest") === "function";
}

export function initAccountDialogs(deps: AccountDialogsDeps): void {
	deps.document.addEventListener(
		"toggle",
		(event) => {
			const dialog = event.target;
			if (event.newState !== "closed" || !isElement(dialog)) return;
			const focused = deps.document.activeElement;
			if (focused !== deps.document.body && !dialog.contains(focused)) return;
			const invoker = deps.document.querySelector<HTMLElement>(
				`[popovertarget="${dialog.id}"]:not([popovertargetaction="hide"])`,
			);
			if (invoker !== null) invoker.focus({ preventScroll: true });
		},
		true,
	);
}
