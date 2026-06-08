import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import {
	type SpeechSynthesisLike,
	type TtsUtterance,
	type TtsVoice,
	extractArticleText,
	formatVoiceLabel,
	initArticleTts,
	parseRate,
	pickDefaultVoice,
	scoreVoice,
	splitIntoChunks,
} from "./article-tts.client";

const VOICE_SAMANTHA: TtsVoice = {
	voiceURI: "samantha",
	name: "Samantha",
	lang: "en-US",
	localService: true,
	default: true,
};
const VOICE_GOOGLE: TtsVoice = {
	voiceURI: "google-us",
	name: "Google US English",
	lang: "en-US",
	localService: false,
	default: false,
};
const VOICE_FRENCH: TtsVoice = {
	voiceURI: "amelie",
	name: "Amelie",
	lang: "fr-FR",
	localService: true,
	default: false,
};

describe("splitIntoChunks", () => {
	it("returns no chunks for empty or whitespace-only text", () => {
		assert.deepEqual(splitIntoChunks(""), []);
		assert.deepEqual(splitIntoChunks("   \n\t  "), []);
	});

	it("keeps short text as a single chunk and collapses whitespace", () => {
		assert.deepEqual(splitIntoChunks("Hello   there\nworld."), [
			"Hello there world.",
		]);
	});

	it("splits long text into chunks no longer than maxChars at word boundaries", () => {
		const text = "alpha bravo charlie delta echo foxtrot golf hotel india";
		const chunks = splitIntoChunks(text, 20);
		for (const chunk of chunks) {
			assert.ok(chunk.length <= 20, `chunk "${chunk}" exceeds 20 chars`);
		}
		assert.equal(chunks.join(" "), text);
		assert.ok(chunks.length > 1, "long text should produce multiple chunks");
	});

	it("emits a single oversized chunk for a word longer than maxChars", () => {
		const longWord = "x".repeat(40);
		assert.deepEqual(splitIntoChunks(longWord, 20), [longWord]);
	});
});

describe("extractArticleText", () => {
	it("separates block boundaries with a space so headings and paragraphs do not jam", () => {
		const { document } = new JSDOM(
			"<!doctype html><html><body><h1>Title</h1><p>One.</p>\n\n<p>Two.</p></body></html>",
		).window;
		assert.equal(extractArticleText(document), "Title One. Two.");
	});

	it("keeps words split across inline elements whole", () => {
		const { document } = new JSDOM(
			'<!doctype html><html><body><p>So<em>ft</em>ware is <a href="#">great</a>.</p></body></html>',
		).window;
		assert.equal(extractArticleText(document), "Software is great.");
	});

	it("separates list items so they are not spoken as one word", () => {
		const { document } = new JSDOM(
			"<!doctype html><html><body><ul><li>One</li><li>Two</li></ul></body></html>",
		).window;
		assert.equal(extractArticleText(document), "One Two");
	});

	it("skips style and script content captured inside the article body", () => {
		const { document } = new JSDOM(
			"<!doctype html><html><body><p>Visible.</p><style>.x{color:red}</style><script>var a=1;</script></body></html>",
		).window;
		assert.equal(extractArticleText(document), "Visible.");
	});

	it("returns an empty string for an empty body", () => {
		const { document } = new JSDOM(
			"<!doctype html><html><body></body></html>",
		).window;
		assert.equal(extractArticleText(document), "");
	});
});

describe("scoreVoice", () => {
	it("rewards a language-prefix match", () => {
		assert.equal(scoreVoice(VOICE_SAMANTHA, "en-US"), 101);
		assert.equal(scoreVoice(VOICE_FRENCH, "en-US"), 0);
	});

	it("rewards fidelity markers, network voices, and the browser default", () => {
		assert.equal(scoreVoice(VOICE_GOOGLE, "en"), 115);
		const edgeNatural: TtsVoice = {
			voiceURI: "natural-de",
			name: "Microsoft Katja Online (Natural)",
			lang: "de-DE",
			localService: false,
			default: false,
		};
		assert.equal(scoreVoice(edgeNatural, "en"), 15);
	});
});

describe("pickDefaultVoice", () => {
	it("returns undefined for an empty list", () => {
		assert.equal(pickDefaultVoice([], "en"), undefined);
	});

	it("picks the highest-scoring voice for the language", () => {
		const picked = pickDefaultVoice(
			[VOICE_SAMANTHA, VOICE_GOOGLE, VOICE_FRENCH],
			"en-US",
		);
		assert.equal(picked, VOICE_GOOGLE);
	});

	it("keeps the first voice when a later one does not score higher", () => {
		const picked = pickDefaultVoice([VOICE_SAMANTHA, VOICE_FRENCH], "en-US");
		assert.equal(picked, VOICE_SAMANTHA);
	});
});

describe("formatVoiceLabel", () => {
	it("renders the name and language", () => {
		assert.equal(formatVoiceLabel(VOICE_GOOGLE), "Google US English (en-US)");
	});
});

describe("parseRate", () => {
	it("parses a positive rate", () => {
		assert.equal(parseRate("1.5"), 1.5);
	});

	it("falls back to 1 for unparseable, zero, or negative values", () => {
		assert.equal(parseRate(""), 1);
		assert.equal(parseRate("not-a-number"), 1);
		assert.equal(parseRate("0"), 1);
		assert.equal(parseRate("-2"), 1);
	});
});

const SAMPLE_TEXT = "First sentence here. Second sentence follows.";

function audioSlotHtml(): string {
	return `<div data-article-tts hidden>
		<div>
			<button type="button" data-tts-toggle><span data-tts-toggle-label>Listen</span></button>
			<button type="button" data-tts-stop>Stop</button>
			<label><select data-tts-voice></select></label>
			<label><select data-tts-rate>
				<option value="0.75">0.75×</option>
				<option value="1" selected>1×</option>
				<option value="1.25">1.25×</option>
				<option value="1.5">1.5×</option>
			</select></label>
		</div>
		<p data-tts-status></p>
	</div>`;
}

interface SynthHarness {
	synth: SpeechSynthesisLike;
	spoken: TtsUtterance[];
	counts: { cancel: number; pause: number; resume: number };
	lastUtterance(): TtsUtterance;
	setVoices(voices: TtsVoice[]): void;
	fireVoicesChanged(): void;
}

function makeSynth(initialVoices: TtsVoice[] = []): SynthHarness {
	let voices = initialVoices;
	const spoken: TtsUtterance[] = [];
	const counts = { cancel: 0, pause: 0, resume: 0 };
	const voicesChangedListeners: Array<() => void> = [];
	const synth: SpeechSynthesisLike = {
		speak(utterance) {
			spoken.push(utterance);
		},
		cancel() {
			counts.cancel += 1;
		},
		pause() {
			counts.pause += 1;
		},
		resume() {
			counts.resume += 1;
		},
		getVoices() {
			return voices;
		},
		addEventListener(type, listener) {
			if (type === "voiceschanged") voicesChangedListeners.push(listener);
		},
	};
	return {
		synth,
		spoken,
		counts,
		lastUtterance: () => spoken[spoken.length - 1],
		setVoices: (next) => {
			voices = next;
		},
		fireVoicesChanged: () => {
			for (const listener of voicesChangedListeners.slice()) listener();
		},
	};
}

function createUtterance(text: string): TtsUtterance {
	return { text, voice: null, rate: 1, lang: "", onend: null, onerror: null };
}

interface SetupOptions {
	html?: string;
	voices?: TtsVoice[];
	supported?: boolean;
	articleText?: string | undefined;
	lang?: string;
}

function setup(options: SetupOptions = {}) {
	const dom = new JSDOM(
		`<!doctype html><html><body>${options.html ?? audioSlotHtml()}</body></html>`,
	);
	const doc = dom.window.document;
	if (options.lang !== undefined) {
		doc.documentElement.setAttribute("lang", options.lang);
	}
	const synthHarness = makeSynth(options.voices ?? []);
	const articleText = {
		value: "articleText" in options ? options.articleText : SAMPLE_TEXT,
	};
	const swapListeners: Array<() => void> = [];
	const controller = initArticleTts({
		document: doc,
		synth: options.supported === false ? undefined : synthHarness.synth,
		createUtterance,
		getArticleText: () => articleText.value,
		addSwapListener: (listener) => swapListeners.push(listener),
	});
	return {
		dom,
		doc,
		synthHarness,
		controller,
		articleText,
		fireSwap: () => {
			for (const listener of swapListeners.slice()) listener();
		},
	};
}

function el<E extends Element>(doc: Document, selector: string): E {
	const found = doc.querySelector<E>(selector);
	assert.ok(found, `expected ${selector} in fixture`);
	return found;
}

function statusText(doc: Document): string | null {
	return el<HTMLElement>(doc, "[data-tts-status]").textContent;
}

function toggleLabel(doc: Document): string | null {
	return el<HTMLElement>(doc, "[data-tts-toggle-label]").textContent;
}

function clickToggle(doc: Document): void {
	el<HTMLButtonElement>(doc, "[data-tts-toggle]").click();
}

function clickStop(doc: Document): void {
	el<HTMLButtonElement>(doc, "[data-tts-stop]").click();
}

/** Build a fresh control owned by the same document, mimicking an htmx swap
 * that replaces the reader chrome with a newly parsed copy. */
function freshControl(doc: Document): Element {
	const wrapper = doc.createElement("div");
	wrapper.innerHTML = audioSlotHtml();
	const control = wrapper.firstElementChild;
	assert.ok(control, "audioSlotHtml must yield an element");
	return control;
}

describe("initArticleTts", () => {
	it("is a no-op when no [data-article-tts] control is present", () => {
		const env = setup({ html: "<p>No control here</p>" });
		assert.equal(env.synthHarness.spoken.length, 0);
		env.controller.stop();
	});

	it("reveals the control and disables it when synthesis is unsupported", () => {
		const env = setup({ supported: false });
		const root = el<HTMLElement>(env.doc, "[data-article-tts]");
		assert.equal(root.hidden, false);
		assert.equal(statusText(env.doc), "This browser doesn't support read-aloud yet.");
		assert.equal(el<HTMLButtonElement>(env.doc, "[data-tts-toggle]").disabled, true);
		assert.equal(el<HTMLButtonElement>(env.doc, "[data-tts-stop]").disabled, true);
		assert.equal(el<HTMLSelectElement>(env.doc, "[data-tts-voice]").disabled, true);
		assert.equal(el<HTMLSelectElement>(env.doc, "[data-tts-rate]").disabled, true);
		env.controller.stop();
	});

	it("reveals the control and lists available voices when supported", () => {
		const env = setup({ voices: [VOICE_SAMANTHA, VOICE_GOOGLE], lang: "en-US" });
		const root = el<HTMLElement>(env.doc, "[data-article-tts]");
		assert.equal(root.hidden, false);
		assert.equal(toggleLabel(env.doc), "Listen");

		const voiceSelect = el<HTMLSelectElement>(env.doc, "[data-tts-voice]");
		const optionValues = Array.from(voiceSelect.options).map((o) => o.value);
		assert.deepEqual(optionValues, ["samantha", "google-us"]);
		const optionLabels = Array.from(voiceSelect.options).map((o) => o.textContent);
		assert.deepEqual(optionLabels, [
			"Samantha (en-US)",
			"Google US English (en-US)",
		]);
		assert.equal(voiceSelect.value, "google-us");
		env.controller.stop();
	});

	it("shows a loading placeholder when no voices are ready yet", () => {
		const env = setup({ voices: [] });
		const voiceSelect = el<HTMLSelectElement>(env.doc, "[data-tts-voice]");
		assert.equal(voiceSelect.options.length, 1);
		assert.equal(voiceSelect.options[0].textContent, "Loading voices…");
		env.controller.stop();
	});

	it("repopulates voices when the browser fires voiceschanged", () => {
		const env = setup({ voices: [] });
		const voiceSelect = el<HTMLSelectElement>(env.doc, "[data-tts-voice]");
		assert.equal(voiceSelect.options.length, 1);

		env.synthHarness.setVoices([VOICE_SAMANTHA, VOICE_GOOGLE]);
		env.synthHarness.fireVoicesChanged();

		assert.deepEqual(
			Array.from(voiceSelect.options).map((o) => o.value),
			["samantha", "google-us"],
		);
		env.controller.stop();
	});

	it("keeps the reader's voice selection when voiceschanged rebuilds the list", () => {
		const env = setup({ voices: [VOICE_SAMANTHA, VOICE_GOOGLE], lang: "en-US" });
		const voiceSelect = el<HTMLSelectElement>(env.doc, "[data-tts-voice]");
		assert.equal(voiceSelect.value, "google-us"); // scored default
		voiceSelect.value = "samantha"; // reader picks a different voice

		env.synthHarness.fireVoicesChanged();

		assert.equal(voiceSelect.value, "samantha");
		env.controller.stop();
	});

	it("ignores voiceschanged when no control is bound", () => {
		const env = setup({ html: "<p>No control</p>" });
		assert.doesNotThrow(() => env.synthHarness.fireVoicesChanged());
		env.controller.stop();
	});

	it("ignores voiceschanged after the controller is stopped", () => {
		const env = setup({ voices: [] });
		env.controller.stop();
		env.synthHarness.setVoices([VOICE_SAMANTHA]);

		env.synthHarness.fireVoicesChanged();

		const voiceSelect = el<HTMLSelectElement>(env.doc, "[data-tts-voice]");
		assert.equal(voiceSelect.options.length, 1);
		assert.equal(voiceSelect.options[0].textContent, "Loading voices…");
	});

	it("starts read-aloud on the first toggle, speaking the first chunk with the selected voice", () => {
		const env = setup({ voices: [VOICE_SAMANTHA, VOICE_GOOGLE], lang: "en-US" });
		clickToggle(env.doc);

		assert.equal(env.synthHarness.spoken.length, 1);
		const utterance = env.synthHarness.lastUtterance();
		assert.equal(utterance.text, "First sentence here. Second sentence follows.");
		assert.equal(utterance.voice, VOICE_GOOGLE);
		assert.equal(utterance.lang, "en-US");
		assert.equal(utterance.rate, 1);
		assert.equal(toggleLabel(env.doc), "Pause");
		assert.equal(statusText(env.doc), "Reading aloud with Google US English.");
		env.controller.stop();
	});

	it("applies the selected playback speed to the utterance", () => {
		const env = setup({ voices: [VOICE_SAMANTHA] });
		el<HTMLSelectElement>(env.doc, "[data-tts-rate]").value = "1.5";
		clickToggle(env.doc);
		assert.equal(env.synthHarness.lastUtterance().rate, 1.5);
		env.controller.stop();
	});

	it("speaks without a voice (null) when none are available", () => {
		const env = setup({ voices: [] });
		clickToggle(env.doc);
		const utterance = env.synthHarness.lastUtterance();
		assert.equal(utterance.voice, null);
		assert.equal(utterance.lang, "");
		assert.equal(statusText(env.doc), "Reading the article aloud.");
		env.controller.stop();
	});

	it("shows a not-ready message and does not speak when the article text is missing", () => {
		const env = setup({ voices: [VOICE_SAMANTHA], articleText: undefined });
		clickToggle(env.doc);
		assert.equal(env.synthHarness.spoken.length, 0);
		assert.equal(
			statusText(env.doc),
			"The article is still loading. Try Listen again in a moment.",
		);
		assert.equal(toggleLabel(env.doc), "Listen");
		env.controller.stop();
	});

	it("treats whitespace-only article text as not ready", () => {
		const env = setup({ voices: [VOICE_SAMANTHA], articleText: "   \n  " });
		clickToggle(env.doc);
		assert.equal(env.synthHarness.spoken.length, 0);
		assert.equal(
			statusText(env.doc),
			"The article is still loading. Try Listen again in a moment.",
		);
		env.controller.stop();
	});

	it("advances to the next chunk when an utterance ends, then settles back to idle", () => {
		const env = setup({
			voices: [VOICE_SAMANTHA],
			articleText: `${"alpha ".repeat(60)}beta.`,
		});
		clickToggle(env.doc);
		const spokenAfterStart = env.synthHarness.spoken.length;
		assert.ok(spokenAfterStart >= 1, "first chunk should be spoken on start");

		env.synthHarness.lastUtterance().onend?.();
		assert.ok(
			env.synthHarness.spoken.length > spokenAfterStart,
			"ending a chunk should speak the next one",
		);

		// Drain the remaining chunks until onend reaches the natural finish.
		for (let guard = 0; guard < 50; guard += 1) {
			const before = env.synthHarness.spoken.length;
			env.synthHarness.lastUtterance().onend?.();
			if (env.synthHarness.spoken.length === before) break;
		}
		assert.equal(toggleLabel(env.doc), "Listen");
		assert.equal(statusText(env.doc), "");
		env.controller.stop();
	});

	it("pauses and resumes around the synthesis engine", () => {
		const env = setup({ voices: [VOICE_SAMANTHA] });
		clickToggle(env.doc); // play (start clears any global pause: resume #1)
		clickToggle(env.doc); // pause
		assert.equal(env.synthHarness.counts.pause, 1);
		assert.equal(toggleLabel(env.doc), "Resume");
		assert.equal(statusText(env.doc), "Paused.");

		clickToggle(env.doc); // resume
		assert.equal(env.synthHarness.counts.resume, 2);
		assert.equal(toggleLabel(env.doc), "Pause");
		assert.equal(statusText(env.doc), "Reading aloud with Samantha.");
		env.controller.stop();
	});

	it("clears the engine's global pause when starting after a pause and stop", () => {
		const env = setup({ voices: [VOICE_SAMANTHA] });
		clickToggle(env.doc); // play
		clickToggle(env.doc); // pause — the engine's global paused flag is now set
		clickStop(env.doc); // cancel() does not clear the paused flag
		const resumesBefore = env.synthHarness.counts.resume;
		const spokenBefore = env.synthHarness.spoken.length;

		clickToggle(env.doc); // listen again

		assert.equal(env.synthHarness.counts.resume, resumesBefore + 1);
		assert.ok(
			env.synthHarness.spoken.length > spokenBefore,
			"a fresh Listen after pause+stop must speak again",
		);
		assert.equal(toggleLabel(env.doc), "Pause");
		env.controller.stop();
	});

	it("stops playback, cancelling synthesis and resetting the UI", () => {
		const env = setup({ voices: [VOICE_SAMANTHA] });
		clickToggle(env.doc); // play
		const cancelsBefore = env.synthHarness.counts.cancel;
		clickStop(env.doc);
		assert.equal(env.synthHarness.counts.cancel, cancelsBefore + 1);
		assert.equal(toggleLabel(env.doc), "Listen");
		assert.equal(statusText(env.doc), "");
		env.controller.stop();
	});

	it("does not advance a chunk whose utterance ends after a stop", () => {
		const env = setup({
			voices: [VOICE_SAMANTHA],
			articleText: `${"alpha ".repeat(60)}beta.`,
		});
		clickToggle(env.doc);
		const stale = env.synthHarness.lastUtterance();
		clickStop(env.doc);
		const spokenAfterStop = env.synthHarness.spoken.length;
		stale.onend?.();
		assert.equal(env.synthHarness.spoken.length, spokenAfterStop);
		env.controller.stop();
	});

	it("does not advance when an utterance ends while paused", () => {
		const env = setup({
			voices: [VOICE_SAMANTHA],
			articleText: `${"alpha ".repeat(60)}beta.`,
		});
		clickToggle(env.doc); // play
		clickToggle(env.doc); // pause
		const current = env.synthHarness.lastUtterance();
		const spokenBefore = env.synthHarness.spoken.length;
		current.onend?.();
		assert.equal(env.synthHarness.spoken.length, spokenBefore);
		env.controller.stop();
	});

	it("surfaces an error and resets when an utterance errors", () => {
		const env = setup({ voices: [VOICE_SAMANTHA] });
		clickToggle(env.doc);
		const utterance = env.synthHarness.lastUtterance();
		const cancelsBefore = env.synthHarness.counts.cancel;
		utterance.onerror?.();
		assert.equal(env.synthHarness.counts.cancel, cancelsBefore + 1);
		assert.equal(toggleLabel(env.doc), "Listen");
		assert.equal(statusText(env.doc), "Read-aloud stopped unexpectedly. Try again?");
		env.controller.stop();
	});

	it("ignores an error from an utterance superseded by a stop", () => {
		const env = setup({ voices: [VOICE_SAMANTHA] });
		clickToggle(env.doc);
		const utterance = env.synthHarness.lastUtterance();
		clickStop(env.doc);
		const cancelsBefore = env.synthHarness.counts.cancel;
		utterance.onerror?.();
		assert.equal(env.synthHarness.counts.cancel, cancelsBefore);
		assert.equal(statusText(env.doc), "");
		env.controller.stop();
	});

	it("re-binds to a replacement control after an htmx swap, cancelling prior playback", () => {
		const env = setup({ voices: [VOICE_SAMANTHA] });
		clickToggle(env.doc); // playing on the original control

		const root = el<HTMLElement>(env.doc, "[data-article-tts]");
		const parent = root.parentElement;
		assert.ok(parent);
		parent.removeChild(root);
		parent.appendChild(freshControl(env.doc));

		const cancelsBefore = env.synthHarness.counts.cancel;
		env.fireSwap();
		assert.equal(
			env.synthHarness.counts.cancel,
			cancelsBefore + 1,
			"swap should cancel playback bound to the removed control",
		);
		// The fresh control is wired: a toggle starts playback again.
		clickToggle(env.doc);
		assert.equal(toggleLabel(env.doc), "Pause");
		env.controller.stop();
	});

	it("tears down playback when the control disappears after a swap", () => {
		const env = setup({ voices: [VOICE_SAMANTHA] });
		clickToggle(env.doc);
		const root = el<HTMLElement>(env.doc, "[data-article-tts]");
		root.parentElement?.removeChild(root);
		const cancelsBefore = env.synthHarness.counts.cancel;
		env.fireSwap();
		assert.equal(env.synthHarness.counts.cancel, cancelsBefore + 1);
		env.controller.stop();
	});

	it("does nothing on a swap that leaves the same control in place", () => {
		const env = setup({ voices: [VOICE_SAMANTHA] });
		const cancelsBefore = env.synthHarness.counts.cancel;
		env.fireSwap();
		assert.equal(env.synthHarness.counts.cancel, cancelsBefore);
		env.controller.stop();
	});

	it("re-reveals a replacement control in the unsupported state after a swap", () => {
		const env = setup({ supported: false });
		const root = el<HTMLElement>(env.doc, "[data-article-tts]");
		const parent = root.parentElement;
		assert.ok(parent);
		parent.removeChild(root);
		parent.appendChild(freshControl(env.doc));

		env.fireSwap();
		const freshRoot = el<HTMLElement>(env.doc, "[data-article-tts]");
		assert.equal(freshRoot.hidden, false);
		assert.equal(el<HTMLButtonElement>(env.doc, "[data-tts-toggle]").disabled, true);
		env.controller.stop();
	});

	it("ignores utterance callbacks that fire after the controller is stopped", () => {
		const env = setup({ voices: [VOICE_SAMANTHA] });
		clickToggle(env.doc);
		const inFlight = env.synthHarness.lastUtterance();
		env.controller.stop();
		const statusAfterStop = statusText(env.doc);
		const cancelsAfterStop = env.synthHarness.counts.cancel;

		inFlight.onerror?.();
		inFlight.onend?.();

		assert.equal(statusText(env.doc), statusAfterStop);
		assert.equal(env.synthHarness.counts.cancel, cancelsAfterStop);
	});

	it("stops scanning and cancels synthesis when the controller is stopped", () => {
		const env = setup({ voices: [VOICE_SAMANTHA] });
		clickToggle(env.doc);
		const cancelsBefore = env.synthHarness.counts.cancel;
		env.controller.stop();
		assert.equal(env.synthHarness.counts.cancel, cancelsBefore + 1);
		// A later swap must not re-bind or speak.
		env.fireSwap();
		assert.equal(env.synthHarness.counts.cancel, cancelsBefore + 1);
	});

	it("stop() is a no-op for synthesis when unsupported", () => {
		const env = setup({ supported: false });
		assert.doesNotThrow(() => env.controller.stop());
	});

	it("throws a clear error when the control markup is missing a child", () => {
		assert.throws(
			() =>
				setup({
					html: '<div data-article-tts hidden><button data-tts-toggle></button></div>',
				}),
			/missing \[data-tts-toggle-label\]/,
		);
	});
});
