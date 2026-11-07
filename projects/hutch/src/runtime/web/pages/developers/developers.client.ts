import { initClipboardCopy } from "@packages/web-shell/clipboard-copy.client";

type DevelopersTimerId = ReturnType<typeof setTimeout>;

interface IntersectionChange {
	readonly target: Element;
	readonly isIntersecting: boolean;
}

interface IntersectionWatch {
	observe(target: Element): void;
	disconnect(): void;
}

interface DevelopersDeps {
	document: Document;
	navigator: { clipboard?: { writeText(text: string): Promise<void> } };
	setTimeoutFn: (cb: () => void, ms: number) => DevelopersTimerId;
	clearTimeoutFn: (id: DevelopersTimerId) => void;
	observeIntersections: (
		onChange: (changes: readonly IntersectionChange[]) => void,
		options: { rootMargin: string },
	) => IntersectionWatch;
	headerOffset: () => number;
	isNarrowViewport: () => boolean;
	addSettleListener: (listener: () => void) => void;
}

const NAV_ID = "on-this-page";
const COPY_SELECTOR = "[data-developers-copy]";
const TEXT_ATTR = "data-developers-text";

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

export function initDevelopers(deps: DevelopersDeps): void {
	const clipboardCopy = initClipboardCopy({
		document: deps.document,
		navigator: deps.navigator,
		setTimeoutFn: deps.setTimeoutFn,
		clearTimeoutFn: deps.clearTimeoutFn,
		copySelector: COPY_SELECTOR,
		textAttr: TEXT_ATTR,
	});
	let watch: IntersectionWatch | undefined;

	function addCopyButtons(): void {
		for (const sample of Array.from(deps.document.querySelectorAll(".developers__sample"))) {
			if (sample.querySelector(COPY_SELECTOR)) continue;
			const code = sample.querySelector(".developers__code");
			assert(code, "every developers sample holds its code");
			const button = deps.document.createElement("button");
			button.type = "button";
			button.className = "btn btn--s developers__copy";
			button.hidden = true;
			button.setAttribute("data-developers-copy", "");
			button.setAttribute("aria-label", "Copy this sample");
			button.setAttribute(TEXT_ATTR, String(code.textContent));
			button.textContent = "Copy";
			sample.prepend(button);
		}
		clipboardCopy.attach();
	}

	function collapseNavOnNarrowViewport(): void {
		if (!deps.isNarrowViewport()) return;
		const details = deps.document.getElementById(NAV_ID);
		assert(details, `the developers page holds #${NAV_ID}`);
		details.removeAttribute("open");
	}

	function watchSections(): void {
		watch?.disconnect();
		const links = Array.from(deps.document.querySelectorAll(`#${NAV_ID} a[href^="#"]`));
		const targets = links.map((link) => {
			const id = String(link.getAttribute("href")).slice(1);
			const target = deps.document.getElementById(id);
			assert(target, `the developers page holds the section that #${id} links to`);
			return target;
		});
		const intersecting = new Set<Element>();
		let current = links[0];
		const mark = (): void => {
			for (const link of links) {
				if (link === current) link.setAttribute("aria-current", "location");
				else link.removeAttribute("aria-current");
			}
		};
		mark();
		const onChange = (changes: readonly IntersectionChange[]): void => {
			for (const change of changes) {
				if (change.isIntersecting) intersecting.add(change.target);
				else intersecting.delete(change.target);
			}
			const index = targets.findIndex(
				(target) =>
					intersecting.has(target) &&
					!targets.some((other) => other !== target && target.contains(other) && intersecting.has(other)),
			);
			if (index === -1) return;
			current = links[index];
			mark();
		};
		const nextWatch = deps.observeIntersections(onChange, {
			rootMargin: `-${deps.headerOffset()}px 0px -50% 0px`,
		});
		for (const target of targets) nextWatch.observe(target);
		watch = nextWatch;
	}

	function run(): void {
		addCopyButtons();
		collapseNavOnNarrowViewport();
		watchSections();
	}

	run();
	deps.addSettleListener(run);
}
