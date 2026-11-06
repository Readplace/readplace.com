interface PlayerWindow {
	readonly location: { readonly search: string };
	readonly history: { replaceState(data: null, unused: "", url: string): void };
	addEventListener(type: "click", listener: (event: MouseEvent) => void, capture: true): void;
}

interface PlayerDeps {
	document: Document;
	window: PlayerWindow;
	addSwapListener: (listener: () => void) => void;
}

const AUDIO_SELECTOR = "[data-player-audio]";
const SEEK_LINK_SELECTOR = '[data-article-body] a[href^="?t="]';
const CURRENT_SELECTOR = '[data-article-body] [aria-current="true"]';
const BOUND_FLAG = "data-player-bound";
const HAVE_METADATA = 1;

function isElement(node: EventTarget | null): node is Element {
	return typeof Reflect.get(Object(node), "closest") === "function";
}

function secondsOf(query: string): number | undefined {
	const raw = new URLSearchParams(query).get("t");
	if (raw === null) return undefined;
	const seconds = Number(raw);
	return Number.isFinite(seconds) && seconds >= 0 ? seconds : undefined;
}

function seekSecondsOf(link: Element): number | undefined {
	return secondsOf(String(link.getAttribute("href")).slice(1));
}

function noop(): void {}

export function initPlayer(deps: PlayerDeps): void {
	const findAudio = () => deps.document.querySelector<HTMLAudioElement>(AUDIO_SELECTOR);
	if (findAudio() === null) return;

	const highlight = (audio: HTMLAudioElement): void => {
		let current: Element | null = null;
		for (const link of Array.from(deps.document.querySelectorAll(SEEK_LINK_SELECTOR))) {
			const start = seekSecondsOf(link);
			if (start === undefined || start > audio.currentTime) continue;
			current = link.closest("p");
		}
		const previous = deps.document.querySelector(CURRENT_SELECTOR);
		if (previous === current) return;
		previous?.removeAttribute("aria-current");
		current?.setAttribute("aria-current", "true");
	};

	const bind = (): void => {
		const audio = findAudio();
		if (audio === null || audio.getAttribute(BOUND_FLAG) === "true") return;
		audio.setAttribute(BOUND_FLAG, "true");
		audio.addEventListener("timeupdate", () => highlight(audio));
		const start = secondsOf(deps.window.location.search);
		if (start === undefined) return;
		const seek = () => {
			audio.currentTime = start;
		};
		if (audio.readyState >= HAVE_METADATA) seek();
		else audio.addEventListener("loadedmetadata", seek, { once: true });
	};

	deps.window.addEventListener(
		"click",
		(event) => {
			const target = event.target;
			if (!isElement(target)) return;
			const link = target.closest(SEEK_LINK_SELECTOR);
			const audio = findAudio();
			if (link === null || audio === null) return;
			const start = seekSecondsOf(link);
			if (start === undefined) return;
			event.preventDefault();
			audio.currentTime = start;
			audio.play().catch(noop);
			const params = new URLSearchParams(deps.window.location.search);
			params.set("t", String(start));
			deps.window.history.replaceState(null, "", `?${params.toString()}`);
		},
		true,
	);
	deps.addSwapListener(bind);
	bind();
}
