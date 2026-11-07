import assert from "node:assert/strict";
import { JSDOM, VirtualConsole } from "jsdom";
import { initReaderExitConfirm } from "../../pages/reader/reader-exit-confirm.client";
import { initPlayer } from "./player.client";

const PAGE_URL = "http://localhost:3000/queue/abc/view";

const PLAYER = `<div class="reader-player"><audio id="audio" data-player-audio></audio></div>`;

const TRANSCRIPT = `<div class="reader__article-body" data-article-body>
	<div class="article-body__content">
		<h2>00:00</h2>
		<p id="p5"><a id="seek-5" href="?t=5">00:05</a> First words.</p>
		<p id="p83"><a id="seek-83" href="?t=83">01:23</a> Second words.</p>
		<p id="p120"><a id="seek-120" href="?t=120">02:00</a> Third words.</p>
		<p id="p-bad"><a id="seek-bad" href="?t=soon">later</a> Odd link.</p>
		<p><a id="out" href="https://example.com/out">out</a></p>
	</div>
</div>`;

const EXIT_PANEL = `<div id="reader-exit-confirm" popover="auto">
	<form method="POST" action="/queue/abc/status" data-exit-confirm-form data-exit-confirm-scopes=".article-body__content">
		<button type="button" data-exit-confirm-decline>No</button>
	</form>
</div>`;

function createHarness(options: { url?: string; player?: boolean; extra?: string } = {}) {
	const player = options.player === false ? "" : PLAYER;
	const dom = new JSDOM(
		`<!doctype html><html><body><main class="reader">${player}${TRANSCRIPT}</main>${options.extra ?? ""}</body></html>`,
		{ url: options.url ?? PAGE_URL, virtualConsole: new VirtualConsole() },
	);
	const document = dom.window.document;
	const listened: string[] = [];
	const swapListeners: Array<() => void> = [];
	const plays: number[] = [];
	let playResult: () => Promise<void> = () => Promise.resolve();

	const audioElement = (): HTMLAudioElement => {
		const audio = document.querySelector<HTMLAudioElement>("audio");
		assert(audio, "the fixture must render the audio element");
		return audio;
	};
	const stubPlay = (audio: HTMLAudioElement): void => {
		audio.play = () => {
			plays.push(audio.currentTime);
			return playResult();
		};
	};
	if (options.player !== false) stubPlay(audioElement());

	const init = () =>
		initPlayer({
			document,
			window: {
				location: dom.window.location,
				history: dom.window.history,
				addEventListener: (type, listener, capture) => {
					listened.push(type);
					dom.window.addEventListener(type, listener, capture);
				},
			},
			addSwapListener: (listener) => {
				listened.push("htmx:afterSwap");
				swapListeners.push(listener);
			},
		});

	function element(id: string): Element {
		const found = document.getElementById(id);
		assert(found, `#${id} must exist in the fixture`);
		return found;
	}

	return {
		dom,
		document,
		listened,
		plays,
		init,
		element,
		audio: audioElement,
		stubPlay,
		rejectPlay() {
			playResult = () => Promise.reject(new Error("NotAllowedError"));
		},
		swap() {
			for (const listener of swapListeners) listener();
		},
		click(target: EventTarget): boolean {
			return target.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true, cancelable: true }));
		},
		playTo(seconds: number) {
			const audio = audioElement();
			audio.currentTime = seconds;
			audio.dispatchEvent(new dom.window.Event("timeupdate"));
		},
		current(): string[] {
			return Array.from(document.querySelectorAll('[aria-current="true"]')).map((node) => node.id);
		},
	};
}

describe("initPlayer", () => {
	it("seeks to a timestamp link's second, plays, and records it in the URL instead of navigating", () => {
		const harness = createHarness();
		harness.init();

		const followed = harness.click(harness.element("seek-83"));

		expect(followed).toBe(false);
		expect(harness.audio().currentTime).toBe(83);
		expect(harness.plays).toEqual([83]);
		expect(harness.dom.window.location.search).toBe("?t=83");
	});

	it("keeps the reader's other query parameters when it records the timestamp", () => {
		const harness = createHarness({ url: `${PAGE_URL}?section=2&t=5` });
		harness.init();

		harness.click(harness.element("seek-120"));

		expect(harness.dom.window.location.search).toBe("?section=2&t=120");
	});

	it("still seeks when the browser refuses to start playback", async () => {
		const harness = createHarness();
		harness.rejectPlay();
		harness.init();

		harness.click(harness.element("seek-83"));
		await Promise.resolve();

		expect(harness.audio().currentTime).toBe(83);
		expect(harness.plays).toEqual([83]);
	});

	it("leaves a click on any other link, a malformed timestamp or the document itself alone", () => {
		const harness = createHarness();
		harness.init();

		expect(harness.click(harness.element("out"))).toBe(true);
		expect(harness.click(harness.element("seek-bad"))).toBe(true);
		expect(harness.click(harness.document)).toBe(true);
		expect(harness.plays).toEqual([]);
		expect(harness.dom.window.location.search).toBe("");
	});

	it("leaves a timestamp link alone once the player is gone", () => {
		const harness = createHarness();
		harness.init();
		harness.audio().closest(".reader-player")?.remove();
		harness.swap();

		expect(harness.click(harness.element("seek-83"))).toBe(true);
	});

	it("marks the paragraph with the latest start at or before the playback position as current", () => {
		const harness = createHarness();
		harness.init();

		harness.playTo(90);
		expect(harness.current()).toEqual(["p83"]);

		harness.playTo(90.5);
		expect(harness.current()).toEqual(["p83"]);

		harness.playTo(120);
		expect(harness.current()).toEqual(["p120"]);

		harness.playTo(2);
		expect(harness.current()).toEqual([]);
	});

	it("seeks to the URL's timestamp once the audio's metadata has loaded", () => {
		const harness = createHarness({ url: `${PAGE_URL}?t=120` });
		harness.init();

		expect(harness.audio().currentTime).toBe(0);
		harness.audio().dispatchEvent(new harness.dom.window.Event("loadedmetadata"));

		expect(harness.audio().currentTime).toBe(120);
	});

	it("seeks to the URL's timestamp at once when the metadata is already loaded", () => {
		const harness = createHarness({ url: `${PAGE_URL}?t=120` });
		Object.defineProperty(harness.audio(), "readyState", { value: 1 });
		harness.init();

		expect(harness.audio().currentTime).toBe(120);
	});

	it.each(["?t=soon", "?t=-4", "?section=2"])("does not seek on load for %s", (search) => {
		const harness = createHarness({ url: `${PAGE_URL}${search}` });
		harness.init();
		harness.audio().dispatchEvent(new harness.dom.window.Event("loadedmetadata"));

		expect(harness.audio().currentTime).toBe(0);
	});

	it("binds a player that a swap brings in, and binds an unchanged player once", () => {
		const harness = createHarness();
		harness.init();
		harness.swap();
		const replacement = harness.document.createElement("audio");
		replacement.setAttribute("data-player-audio", "");
		harness.audio().replaceWith(replacement);
		harness.stubPlay(replacement);
		harness.swap();
		harness.swap();

		harness.playTo(90);
		expect(harness.current()).toEqual(["p83"]);
		expect(replacement.getAttribute("data-player-bound")).toBe("true");
	});

	it("listens for nothing on a page without an audio player", () => {
		const harness = createHarness({ player: false });
		harness.init();

		expect(harness.listened).toEqual([]);
	});

	it("keeps the reader's exit dialog closed when a timestamp link is clicked", () => {
		const harness = createHarness({ extra: EXIT_PANEL });
		const shown: string[] = [];
		initReaderExitConfirm({
			document: harness.document,
			supportsPopover: () => true,
			showPopover: (panel) => {
				shown.push(panel.id);
			},
			hidePopover: () => undefined,
			fetchFn: () => Promise.resolve(undefined),
			follow: () => undefined,
			announceMarkedRead: () => undefined,
		});
		harness.init();

		harness.click(harness.element("seek-83"));
		expect(shown).toEqual([]);

		harness.click(harness.element("out"));
		expect(shown).toEqual(["reader-exit-confirm"]);
	});
});
