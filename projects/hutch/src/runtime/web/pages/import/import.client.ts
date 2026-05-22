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

/**
 * Render an upload byte count with one decimal place when the value rounds
 * up to less than 10 MB. The label is read aloud during a slow upload, so
 * the precision tracks the bar's perceived movement rather than the raw
 * byte total.
 */
export function formatBytes(bytes: number): string {
	const clamped = bytes > 0 ? bytes : 0;
	const mb = clamped / (1024 * 1024);
	if (mb < 0.1) {
		const kb = Math.round(clamped / 1024);
		return `${kb} KB`;
	}
	const rounded = Math.round(mb * 10) / 10;
	return `${rounded.toFixed(1)} MB`;
}

function assert(cond: unknown, message: string): asserts cond {
	if (!cond) throw new Error(message);
}

interface UploadProgressDeps {
	document: Document;
	formatBytes: (bytes: number) => string;
	nativeSubmit: (form: HTMLFormElement) => void;
}

function readNumberField(obj: object, key: string): number {
	const value: unknown = Reflect.get(obj, key);
	return typeof value === "number" ? value : 0;
}

export function initUploadProgress(deps: UploadProgressDeps): void {
	const form = deps.document.querySelector<HTMLFormElement>(
		"form.import__upload-form",
	);
	if (!form) return;

	const fill = form.querySelector<HTMLElement>("[data-import-progress-fill]");
	const label = form.querySelector<HTMLElement>("[data-import-progress-label]");
	assert(fill, "upload form must contain [data-import-progress-fill]");
	assert(label, "upload form must contain [data-import-progress-label]");

	form.addEventListener("htmx:beforeRequest", () => {
		form.dataset.importState = "uploading";
	});

	form.addEventListener("htmx:xhr:progress", (event) => {
		const detail: unknown = Reflect.get(event, "detail");
		if (typeof detail !== "object" || detail === null) return;
		const loaded = readNumberField(detail, "loaded");
		const total = readNumberField(detail, "total");
		if (total <= 0) return;
		const pct = Math.min(100, Math.max(0, Math.round((loaded / total) * 100)));
		fill.style.width = `${pct}%`;
		label.textContent = `Uploading ${deps.formatBytes(loaded)} of ${deps.formatBytes(total)} (${pct}%)`;
	});

	const fallback = (): void => {
		form.dataset.importState = "idle";
		form.removeAttribute("hx-post");
		deps.nativeSubmit(form);
	};

	form.addEventListener("htmx:sendError", fallback);
	form.addEventListener("htmx:responseError", fallback);
	form.addEventListener("htmx:timeout", fallback);
	form.addEventListener("htmx:swapError", fallback);
}
