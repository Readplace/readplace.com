import { noExtract, noRecovery, skipCrawl } from "@packages/site-rules";
import type { SiteRules } from "@packages/site-rules";

const SHARED_NOTE_EDITOR = ".tiptap.ProseMirror";

export const granolaSiteRules = {
	matches: ({ hostname }) => hostname === "notes.granola.ai",
	onCrawl: skipCrawl,
	recoverContent: noRecovery,
	extract: noExtract,
	transform: ({ document }) => {
		const note = document.querySelector(SHARED_NOTE_EDITOR);
		if (note === null) return;
		document.body.replaceChildren(note);
	},
} satisfies SiteRules;
