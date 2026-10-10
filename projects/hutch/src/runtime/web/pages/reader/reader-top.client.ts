interface ReaderTopWindow {
	readonly scrollY: number;
	readonly innerHeight: number;
	addEventListener(
		type: "scroll",
		listener: () => void,
		options: { passive: true },
	): void;
}

interface ReaderTopDeps {
	document: Pick<Document, "documentElement">;
	window: ReaderTopWindow;
}

const SCROLLED_CLASS = "page-scrolled";

export function initReaderTop(deps: ReaderTopDeps): void {
	const root = deps.document.documentElement;
	const update = (): void => {
		root.classList.toggle(SCROLLED_CLASS, deps.window.scrollY > deps.window.innerHeight);
	};
	update();
	deps.window.addEventListener("scroll", update, { passive: true });
}
