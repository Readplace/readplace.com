import { readFileSync } from "node:fs";
import { join } from "node:path";

export const HIGHLIGHTS_STYLES = readFileSync(
	join(__dirname, "highlights.styles.css"),
	"utf-8",
);
