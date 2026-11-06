/**
 * The HTML `indeterminate` state cannot be set via attribute — it is a JS-only
 * property on HTMLInputElement (see MDN: HTMLInputElement.indeterminate). The
 * server marks the master checkbox with `data-import-indeterminate` whenever
 * the import is partially selected; this module promotes that marker into the
 * live `indeterminate` property on initial load and after every htmx swap of
 * <main>, since the swapped-in DOM nodes don't carry runtime properties.
 */

interface IndeterminateCheckbox {
	indeterminate: boolean;
}

interface IndeterminateRoot {
	querySelectorAll(selector: string): ArrayLike<IndeterminateCheckbox>;
}

export function applyIndeterminate(root: IndeterminateRoot): number {
	const matches = root.querySelectorAll(
		'input[type="checkbox"][data-import-indeterminate]',
	);
	for (let i = 0; i < matches.length; i += 1) {
		matches[i].indeterminate = true;
	}
	return matches.length;
}

interface IndeterminateDeps {
	document: IndeterminateRoot;
	addSwapListener: (listener: () => void) => void;
}

export function initIndeterminateCheckboxes(deps: IndeterminateDeps): void {
	const run = (): void => {
		applyIndeterminate(deps.document);
	};
	deps.addSwapListener(run);
	run();
}
