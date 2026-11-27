export const HIGHLIGHT_NOTE_MAX_LENGTH = 8191;

export function cleanHighlightNote(value: string | undefined): string | undefined {
	const cleaned = (value ?? "").replace(/\r\n/g, "\n").trim();
	return cleaned === "" ? undefined : cleaned;
}

type JoinedNote = { ok: true; note?: string } | { ok: false };

export function joinNotesNewestFirst(notes: readonly (string | undefined)[]): JoinedNote {
	const parts = notes.filter((part) => part !== undefined);
	if (parts.length === 0) return { ok: true };
	const note = parts.join("\n\n");
	if (note.length > HIGHLIGHT_NOTE_MAX_LENGTH) return { ok: false };
	return { ok: true, note };
}
