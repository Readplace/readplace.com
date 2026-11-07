import { readFileSync } from "node:fs";
import { join } from "node:path";

export const HIGHLIGHT_NOTE_STYLES = readFileSync(
	join(__dirname, "highlight-note.styles.css"),
	"utf-8",
);
