import { readFileSync } from "node:fs";
import { join } from "node:path";

export const HIGHLIGHT_TOOLBAR_STYLES = readFileSync(join(__dirname, "highlight-toolbar.styles.css"), "utf-8");
