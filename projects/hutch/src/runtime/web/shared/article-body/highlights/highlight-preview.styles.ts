import { readFileSync } from "node:fs";
import { join } from "node:path";

export const HIGHLIGHT_PREVIEW_STYLES = readFileSync(join(__dirname, "highlight-preview.styles.css"), "utf-8");
