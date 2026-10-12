interface TableOfContentsWindow {
	addEventListener(type: "scroll", listener: () => void, options: { passive: true }): void;
	requestAnimationFrame(callback: () => void): unknown;
	getComputedStyle(element: Element): { readonly scrollPaddingTop: string };
}

interface TableOfContentsDeps {
	document: Pick<Document, "documentElement" | "querySelectorAll" | "getElementById">;
	window: TableOfContentsWindow;
	addSettleListener: (listener: () => void) => void;
}

const LINK_SELECTOR = "#table-of-contents .table-of-contents__link";
const CURRENT_CLASS = "table-of-contents__link--current";

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

function headingTopOf(input: { link: Element; document: Pick<Document, "getElementById"> }): number {
	const href = input.link.getAttribute("href");
	assert(href !== null, "every table-of-contents row is a fragment link");
	const heading = input.document.getElementById(href.slice(1));
	assert(heading, `the reader content holds the heading that ${href} links to`);
	return heading.getBoundingClientRect().top;
}

export function initTableOfContents(deps: TableOfContentsDeps): void {
	const sync = (): void => {
		const links = Array.from(deps.document.querySelectorAll(LINK_SELECTOR));
		const line = Number.parseFloat(deps.window.getComputedStyle(deps.document.documentElement).scrollPaddingTop) + 1;
		const passed = links.filter((link) => headingTopOf({ link, document: deps.document }) <= line);
		const current = passed.at(-1) ?? links[0];
		for (const link of links) {
			const isCurrent = link === current;
			link.classList.toggle(CURRENT_CLASS, isCurrent);
			if (isCurrent) link.setAttribute("aria-current", "location");
			else link.removeAttribute("aria-current");
		}
	};
	let frameRequested = false;
	const onScroll = (): void => {
		if (frameRequested) return;
		frameRequested = true;
		deps.window.requestAnimationFrame(() => {
			frameRequested = false;
			sync();
		});
	};
	sync();
	deps.window.addEventListener("scroll", onScroll, { passive: true });
	deps.addSettleListener(sync);
}
