/**
 * Browser-native read-aloud for the reader's article body.
 *
 * Uses the Web Speech API (window.speechSynthesis) — the standard, zero-cost
 * engine every modern browser ships, with no network round-trip or AI service.
 * The voice catalogue is browser- and OS-specific: Edge exposes the
 * "… Online (Natural)" set, Safari the enhanced Siri voices, Chrome the
 * "Google …" voices, Firefox the installed OS voices. The control reads
 * whatever getVoices() reports and lets the reader pick, defaulting to the
 * highest-fidelity match for the page language (see pickDefaultVoice).
 *
 * The article HTML lives inside the sandboxed reader <iframe>; the composition
 * root (build-client-bundles.js footer) reads its same-origin contentDocument
 * and hands the extracted text in via getArticleText, so this module never
 * reaches across the frame boundary itself.
 *
 * Long articles are split into sentence-sized utterances because Chrome stops
 * a single long utterance after ~15s and silently truncates text beyond ~32KB;
 * speakCurrentChunk chains them via onend so playback flows without a gap.
 */

/**
 * Inline assertion. Cannot use `node:assert` because esbuild bundles this
 * module for the browser and `node:assert` is not resolvable in a browser
 * target.
 */
function assert(cond: unknown, message: string): asserts cond {
	if (!cond) throw new Error(`article-tts: ${message}`);
}

/** Structural subset of SpeechSynthesisVoice — the real browser objects flow
 * through unchanged; typing the subset keeps the module free of lib.dom
 * coupling and trivial to fake in tests. */
export interface TtsVoice {
	readonly voiceURI: string;
	readonly name: string;
	readonly lang: string;
	readonly localService: boolean;
	readonly default: boolean;
}

/** Structural subset of SpeechSynthesisUtterance carrying only the fields this
 * module writes and the callbacks it listens on. */
export interface TtsUtterance {
	text: string;
	voice: TtsVoice | null;
	rate: number;
	lang: string;
	onend: (() => void) | null;
	onerror: (() => void) | null;
}

/** Structural subset of window.speechSynthesis. */
export interface SpeechSynthesisLike {
	speak(utterance: TtsUtterance): void;
	cancel(): void;
	pause(): void;
	resume(): void;
	getVoices(): ReadonlyArray<TtsVoice>;
	addEventListener(type: "voiceschanged", listener: () => void): void;
}

export interface ArticleTtsDeps {
	document: Document;
	/** undefined when the browser has no Web Speech synthesis support. */
	synth: SpeechSynthesisLike | undefined;
	createUtterance: (text: string) => TtsUtterance;
	/** Resolves the article body text, or undefined when the reader iframe is
	 * not yet readable. Kept as a dependency so the iframe-crossing logic stays
	 * in the composition root and this module is DOM-fake testable. */
	getArticleText: () => string | undefined;
	addSwapListener: (listener: () => void) => void;
}

export interface ArticleTtsController {
	stop(): void;
}

const LABEL_LISTEN = "Listen";
const LABEL_PAUSE = "Pause";
const LABEL_RESUME = "Resume";

const STATUS_UNSUPPORTED = "This browser doesn't support read-aloud yet.";
const STATUS_NOT_READY =
	"The article is still loading. Try Listen again in a moment.";
const STATUS_PAUSED = "Paused.";
const STATUS_ERROR = "Read-aloud stopped unexpectedly. Try again?";

/** Voices whose names contain one of these markers are the higher-fidelity
 * options each browser exposes for free (Edge "Natural", Safari "Enhanced",
 * Chrome "Google", iOS "Siri"). */
const PREFERRED_VOICE_MARKERS = [
	"natural",
	"enhanced",
	"premium",
	"google",
	"siri",
];

/** Cap per utterance, in characters. Comfortably under Chrome's ~15s / ~32KB
 * single-utterance ceiling while staying long enough to avoid choppy pauses. */
const MAX_CHUNK_CHARS = 200;

function collapseWhitespace(text: string): string {
	return text.replace(/\s+/g, " ").trim();
}

/**
 * Split article text into utterance-sized chunks at word boundaries. Greedy:
 * accumulate words until the next one would exceed maxChars, then start a new
 * chunk. A single word longer than maxChars becomes its own (oversized) chunk
 * rather than being broken mid-word.
 */
export function splitIntoChunks(
	text: string,
	maxChars: number = MAX_CHUNK_CHARS,
): string[] {
	const normalized = collapseWhitespace(text);
	if (normalized.length === 0) return [];

	const chunks: string[] = [];
	let current = "";
	for (const word of normalized.split(" ")) {
		const candidate = current === "" ? word : `${current} ${word}`;
		if (candidate.length > maxChars && current !== "") {
			chunks.push(current);
			current = word;
		} else {
			current = candidate;
		}
	}
	chunks.push(current);
	return chunks;
}

/** Elements whose text content is never prose — reading captured CSS rules
 * or leftover inline scripts aloud would be gibberish. */
const SILENT_NODES = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE"]);

/** Block-level boundaries must become spoken pauses: `</h1><p>Intro` has no
 * whitespace between the text nodes, so plain textContent would jam the
 * heading and the first word into one token ("TitleIntro") and the engine
 * would lose the sentence break. Inline elements (em, a, span) contribute no
 * separator so words split across them stay whole. */
const BLOCK_NODES = new Set([
	"ADDRESS", "ARTICLE", "ASIDE", "BLOCKQUOTE", "BR", "DD", "DIV", "DL", "DT",
	"FIGCAPTION", "FIGURE", "FOOTER", "H1", "H2", "H3", "H4", "H5", "H6",
	"HEADER", "HR", "LI", "MAIN", "NAV", "OL", "P", "PRE", "SECTION", "TABLE",
	"TD", "TH", "TR", "UL",
]);

function appendSpokenText(node: Node, parts: string[]): void {
	if (node.nodeType === node.TEXT_NODE) {
		const text = node.textContent;
		assert(text !== null, "a text node's textContent is its data string");
		parts.push(text);
		return;
	}
	if (SILENT_NODES.has(node.nodeName)) return;
	const isBlock = BLOCK_NODES.has(node.nodeName);
	if (isBlock) parts.push(" ");
	for (const child of Array.from(node.childNodes)) {
		appendSpokenText(child, parts);
	}
	if (isBlock) parts.push(" ");
}

/** Read the article body's speakable text out of an iframe's content
 * document. */
export function extractArticleText(doc: Document): string {
	const body = doc.body;
	assert(body, "reader iframe document must have a <body>");
	const parts: string[] = [];
	appendSpokenText(body, parts);
	return collapseWhitespace(parts.join(""));
}

/** Higher score = better default. Language match dominates, then fidelity
 * markers, then network (non-local) voices, then the browser's own default. */
export function scoreVoice(voice: TtsVoice, lang: string): number {
	let score = 0;
	const langPrefix = lang.slice(0, 2).toLowerCase();
	if (voice.lang.toLowerCase().startsWith(langPrefix)) score += 100;
	const name = voice.name.toLowerCase();
	for (const marker of PREFERRED_VOICE_MARKERS) {
		if (name.includes(marker)) {
			score += 10;
			break;
		}
	}
	if (!voice.localService) score += 5;
	if (voice.default) score += 1;
	return score;
}

export function pickDefaultVoice(
	voices: ReadonlyArray<TtsVoice>,
	lang: string,
): TtsVoice | undefined {
	let best: TtsVoice | undefined;
	let bestScore = Number.NEGATIVE_INFINITY;
	for (const voice of voices) {
		const score = scoreVoice(voice, lang);
		if (score > bestScore) {
			best = voice;
			bestScore = score;
		}
	}
	return best;
}

export function formatVoiceLabel(voice: TtsVoice): string {
	return `${voice.name} (${voice.lang})`;
}

/** Parse a playback-rate select value, falling back to 1 (normal speed) for
 * any non-positive or unparseable input. */
export function parseRate(raw: string): number {
	const rate = Number.parseFloat(raw);
	if (Number.isFinite(rate) && rate > 0) return rate;
	return 1;
}

interface Controls {
	root: HTMLElement;
	toggle: HTMLButtonElement;
	toggleLabel: HTMLElement;
	stopButton: HTMLButtonElement;
	voiceSelect: HTMLSelectElement;
	rateSelect: HTMLSelectElement;
	status: HTMLElement;
}

function pick<E extends Element>(root: ParentNode, selector: string): E {
	const element = root.querySelector<E>(selector);
	assert(element, `missing ${selector}`);
	return element;
}

function resolveControls(root: HTMLElement): Controls {
	return {
		root,
		toggle: pick<HTMLButtonElement>(root, "[data-tts-toggle]"),
		toggleLabel: pick<HTMLElement>(root, "[data-tts-toggle-label]"),
		stopButton: pick<HTMLButtonElement>(root, "[data-tts-stop]"),
		voiceSelect: pick<HTMLSelectElement>(root, "[data-tts-voice]"),
		rateSelect: pick<HTMLSelectElement>(root, "[data-tts-rate]"),
		status: pick<HTMLElement>(root, "[data-tts-status]"),
	};
}

function makeOption(
	doc: Document,
	option: { value: string; label: string },
): HTMLOptionElement {
	const element = doc.createElement("option");
	element.value = option.value;
	element.textContent = option.label;
	return element;
}

type PlaybackMode = "idle" | "playing" | "paused";

export function initArticleTts(deps: ArticleTtsDeps): ArticleTtsController {
	const { synth } = deps;
	let stopped = false;
	let activeRoot: HTMLElement | null = null;
	let activeControls: Controls | null = null;

	let mode: PlaybackMode = "idle";
	let chunks: string[] = [];
	let index = 0;
	/** Bumped on every start and stop so a late onend/onerror from a cancelled
	 * utterance can detect it is stale and not advance playback. */
	let playToken = 0;

	function findRoot(): HTMLElement | null {
		return deps.document.querySelector<HTMLElement>("[data-article-tts]");
	}

	function documentLang(): string {
		return deps.document.documentElement.getAttribute("lang") || "en";
	}

	function setStatus(controls: Controls, text: string): void {
		controls.status.textContent = text;
	}

	function setIdleUi(controls: Controls): void {
		controls.toggleLabel.textContent = LABEL_LISTEN;
	}

	function selectedVoice(
		activeSynth: SpeechSynthesisLike,
		controls: Controls,
	): TtsVoice | null {
		const uri = controls.voiceSelect.value;
		const found = activeSynth.getVoices().find((v) => v.voiceURI === uri);
		return found ?? null;
	}

	function statusReading(
		activeSynth: SpeechSynthesisLike,
		controls: Controls,
	): string {
		const voice = selectedVoice(activeSynth, controls);
		if (voice !== null) return `Reading aloud with ${voice.name}.`;
		return "Reading the article aloud.";
	}

	function populateVoices(
		activeSynth: SpeechSynthesisLike,
		controls: Controls,
	): void {
		const voices = activeSynth.getVoices();
		/** Browsers fire voiceschanged repeatedly (Chrome fires it on every
		 * getVoices catalogue refresh); a rebuild must not discard a voice the
		 * reader explicitly picked. */
		const previousUri = controls.voiceSelect.value;
		controls.voiceSelect.textContent = "";
		if (voices.length === 0) {
			controls.voiceSelect.appendChild(
				makeOption(deps.document, { value: "", label: "Loading voices…" }),
			);
			return;
		}
		for (const voice of voices) {
			controls.voiceSelect.appendChild(
				makeOption(deps.document, {
					value: voice.voiceURI,
					label: formatVoiceLabel(voice),
				}),
			);
		}
		const retained = voices.find((voice) => voice.voiceURI === previousUri);
		if (retained !== undefined) {
			controls.voiceSelect.value = retained.voiceURI;
			return;
		}
		const preferred = pickDefaultVoice(voices, documentLang());
		assert(preferred, "a non-empty voice list always yields a default");
		controls.voiceSelect.value = preferred.voiceURI;
	}

	function finishNatural(controls: Controls): void {
		mode = "idle";
		index = 0;
		setIdleUi(controls);
		setStatus(controls, "");
	}

	function speakCurrentChunk(
		activeSynth: SpeechSynthesisLike,
		controls: Controls,
	): void {
		const token = playToken;
		const utterance = deps.createUtterance(chunks[index]);
		const voice = selectedVoice(activeSynth, controls);
		utterance.voice = voice;
		if (voice !== null) utterance.lang = voice.lang;
		utterance.rate = parseRate(controls.rateSelect.value);
		utterance.onend = () => {
			if (token !== playToken || mode !== "playing") return;
			index += 1;
			if (index < chunks.length) {
				speakCurrentChunk(activeSynth, controls);
			} else {
				finishNatural(controls);
			}
		};
		utterance.onerror = () => {
			if (token !== playToken) return;
			mode = "idle";
			index = 0;
			activeSynth.cancel();
			setIdleUi(controls);
			setStatus(controls, STATUS_ERROR);
		};
		activeSynth.speak(utterance);
	}

	function startPlayback(
		activeSynth: SpeechSynthesisLike,
		controls: Controls,
	): void {
		const text = deps.getArticleText();
		if (text === undefined || collapseWhitespace(text) === "") {
			setStatus(controls, STATUS_NOT_READY);
			return;
		}
		chunks = splitIntoChunks(text);
		index = 0;
		playToken += 1;
		mode = "playing";
		activeSynth.cancel();
		/** cancel() empties the queue but does not clear the engine's global
		 * paused flag (Web Speech spec) — after Pause then Stop, a fresh Listen
		 * would queue into a paused engine and play nothing. resume() clears the
		 * flag and is a no-op when the engine is not paused. */
		activeSynth.resume();
		controls.toggleLabel.textContent = LABEL_PAUSE;
		setStatus(controls, statusReading(activeSynth, controls));
		speakCurrentChunk(activeSynth, controls);
	}

	function pausePlayback(
		activeSynth: SpeechSynthesisLike,
		controls: Controls,
	): void {
		mode = "paused";
		activeSynth.pause();
		controls.toggleLabel.textContent = LABEL_RESUME;
		setStatus(controls, STATUS_PAUSED);
	}

	function resumePlayback(
		activeSynth: SpeechSynthesisLike,
		controls: Controls,
	): void {
		mode = "playing";
		activeSynth.resume();
		controls.toggleLabel.textContent = LABEL_PAUSE;
		setStatus(controls, statusReading(activeSynth, controls));
	}

	function onToggle(
		activeSynth: SpeechSynthesisLike,
		controls: Controls,
	): void {
		if (mode === "idle") startPlayback(activeSynth, controls);
		else if (mode === "playing") pausePlayback(activeSynth, controls);
		else resumePlayback(activeSynth, controls);
	}

	function onStop(activeSynth: SpeechSynthesisLike, controls: Controls): void {
		mode = "idle";
		index = 0;
		playToken += 1;
		activeSynth.cancel();
		setIdleUi(controls);
		setStatus(controls, "");
	}

	function teardown(activeSynth: SpeechSynthesisLike): void {
		mode = "idle";
		index = 0;
		playToken += 1;
		activeSynth.cancel();
	}

	function setUnsupported(controls: Controls): void {
		setStatus(controls, STATUS_UNSUPPORTED);
		controls.toggle.disabled = true;
		controls.stopButton.disabled = true;
		controls.voiceSelect.disabled = true;
		controls.rateSelect.disabled = true;
	}

	function bind(root: HTMLElement): void {
		root.hidden = false;
		const controls = resolveControls(root);
		if (synth === undefined) {
			setUnsupported(controls);
			return;
		}
		activeControls = controls;
		controls.toggle.addEventListener("click", () => onToggle(synth, controls));
		controls.stopButton.addEventListener("click", () => onStop(synth, controls));
		setIdleUi(controls);
		populateVoices(synth, controls);
	}

	function scan(): void {
		if (stopped) return;
		const root = findRoot();
		if (root === activeRoot) return;
		if (synth !== undefined && activeRoot !== null) teardown(synth);
		activeRoot = root;
		activeControls = null;
		if (root === null) return;
		bind(root);
	}

	if (synth !== undefined) {
		synth.addEventListener("voiceschanged", () => {
			if (stopped) return;
			if (activeControls !== null) populateVoices(synth, activeControls);
		});
	}
	scan();
	deps.addSwapListener(scan);

	return {
		stop(): void {
			stopped = true;
			/* In-flight utterance callbacks become stale so a late onend/onerror
			 * cannot mutate the DOM after teardown. */
			playToken += 1;
			if (synth !== undefined) synth.cancel();
		},
	};
}
