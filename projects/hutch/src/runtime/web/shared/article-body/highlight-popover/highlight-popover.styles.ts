import { readFileSync } from "node:fs";
import { join } from "node:path";

export const HIGHLIGHT_POPOVER_STYLES = readFileSync(join(__dirname, "highlight-popover.styles.css"), "utf-8");
