import { readFileSync } from "node:fs";
import { join } from "node:path";

export const HIGHLIGHTS_PANEL_STYLES = readFileSync(
	join(__dirname, "highlights-panel.styles.css"),
	"utf-8",
);
