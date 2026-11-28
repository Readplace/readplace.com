import {
	type Anchor,
	anchorHighlight,
	cleanHighlightNote,
	describeRange,
	joinNotesNewestFirst,
	mergeRanges,
	VIEW_HIGHLIGHT_LIMIT,
	VIEW_HIGHLIGHT_MAX_TEXT_LENGTH,
} from "@packages/domain/article/highlight";

export const LOCAL_HIGHLIGHTS_KEY = "readplace.view-highlights";

const PROBE_KEY = "readplace.view-highlights.probe";

const STORED_VERSION = 1;

export interface LocalHighlight {
	id: string;
	url: string;
	exact: string;
	prefix: string;
	suffix: string;
	start: number;
	end: number;
	note?: string;
	createdAt: string;
}

export interface LocalHighlightState {
	highlight: LocalHighlight;
	anchor: Anchor;
}

export type LocalHighlightAddOutcome =
	| { status: "kept"; highlight: LocalHighlight }
	| { status: "passage-changed" }
	| { status: "too-long" }
	| { status: "limit-reached" }
	| { status: "unavailable" };

export type LocalHighlightNoteOutcome =
	| { status: "saved" }
	| { status: "missing" }
	| { status: "too-long" }
	| { status: "unavailable" };

export interface LocalHighlightStorage {
	getItem(key: string): string | null;
	setItem(key: string, value: string): void;
	removeItem(key: string): void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function isLocalHighlight(value: unknown): value is LocalHighlight {
	if (!isRecord(value)) return false;
	const strings = ["id", "url", "exact", "prefix", "suffix", "createdAt"].every(
		(name) => typeof value[name] === "string",
	);
	const numbers = ["start", "end"].every((name) => Number.isInteger(value[name]));
	const note = value.note === undefined || typeof value.note === "string";
	return strings && numbers && note;
}

function parseStored(raw: string | null): LocalHighlight[] {
	if (raw === null) return [];
	const parsed: unknown = JSON.parse(raw);
	if (!isRecord(parsed) || parsed.version !== STORED_VERSION || !Array.isArray(parsed.items)) return [];
	const items: unknown[] = parsed.items;
	return items.every(isLocalHighlight) ? items.filter(isLocalHighlight) : [];
}

export function initLocalHighlights(deps: {
	storage: LocalHighlightStorage;
	now: () => Date;
	newId: () => string;
}) {
	const all = (): LocalHighlight[] => {
		try {
			return parseStored(deps.storage.getItem(LOCAL_HIGHLIGHTS_KEY));
		} catch {
			return [];
		}
	};

	const write = (items: readonly LocalHighlight[]): boolean => {
		try {
			deps.storage.setItem(LOCAL_HIGHLIGHTS_KEY, JSON.stringify({ version: STORED_VERSION, items }));
			return true;
		} catch {
			return false;
		}
	};

	const list = (url: string): LocalHighlight[] => all().filter((item) => item.url === url);

	const anchorsOn = (input: { url: string; text: string }): LocalHighlightState[] =>
		list(input.url).map((highlight) => ({
			highlight,
			anchor: anchorHighlight({
				text: input.text,
				contentHash: "served",
				highlight: { ...highlight, anchoredContentHash: "kept-in-browser" },
			}),
		}));

	const isAvailable = (): boolean => {
		try {
			deps.storage.setItem(PROBE_KEY, "1");
			deps.storage.removeItem(PROBE_KEY);
			return true;
		} catch {
			return false;
		}
	};

	const add = (input: {
		url: string;
		text: string;
		start: number;
		end: number;
		note?: string;
	}): LocalHighlightAddOutcome => {
		if (input.start >= input.end || input.end > input.text.length) return { status: "passage-changed" };
		const kept = all();
		const anchored = anchorsOn({ url: input.url, text: input.text }).flatMap(({ highlight, anchor }) =>
			anchor.anchorState === "orphaned" ? [] : [{ highlight, start: anchor.start, end: anchor.end }],
		);
		const planned = mergeRanges({
			range: { start: input.start, end: input.end },
			existing: anchored,
			maxLength: Number.POSITIVE_INFINITY,
			canMerge: () => true,
		});
		const merged = [...planned.merged, ...planned.covering];
		const range = merged.reduce(
			(grown, other) => ({ start: Math.min(grown.start, other.start), end: Math.max(grown.end, other.end) }),
			{ start: input.start, end: input.end },
		);
		const described = describeRange({ text: input.text, start: range.start, end: range.end });
		const newestFirst = [...merged].sort((a, b) => b.highlight.createdAt.localeCompare(a.highlight.createdAt));
		const joined = joinNotesNewestFirst([cleanHighlightNote(input.note), ...newestFirst.map(({ highlight }) => highlight.note)]);
		if (described.exact.length > VIEW_HIGHLIGHT_MAX_TEXT_LENGTH) return { status: "too-long" };
		if (!joined.ok || (joined.note !== undefined && joined.note.length > VIEW_HIGHLIGHT_MAX_TEXT_LENGTH)) return { status: "too-long" };
		const { note } = joined;
		const replaced = new Set(merged.map(({ highlight }) => highlight.id));
		const remaining = kept.filter((item) => !replaced.has(item.id));
		if (remaining.length >= VIEW_HIGHLIGHT_LIMIT) return { status: "limit-reached" };
		const highlight: LocalHighlight = {
			...described,
			id: deps.newId(),
			url: input.url,
			createdAt: deps.now().toISOString(),
			...(note === undefined ? {} : { note }),
		};
		return write([...remaining, highlight]) ? { status: "kept", highlight } : { status: "unavailable" };
	};

	const setNote = (input: { id: string; note: string }): LocalHighlightNoteOutcome => {
		const kept = all();
		const target = kept.find((item) => item.id === input.id);
		if (target === undefined) return { status: "missing" };
		const note = cleanHighlightNote(input.note);
		if (note !== undefined && note.length > VIEW_HIGHLIGHT_MAX_TEXT_LENGTH) return { status: "too-long" };
		const { note: _previous, ...rest } = target;
		const updated: LocalHighlight = note === undefined ? rest : { ...rest, note };
		return write(kept.map((item) => (item.id === input.id ? updated : item)))
			? { status: "saved" }
			: { status: "unavailable" };
	};

	const remove = (id: string): boolean => write(all().filter((item) => item.id !== id));

	return { all, anchorsOn, isAvailable, add, setNote, remove };
}
