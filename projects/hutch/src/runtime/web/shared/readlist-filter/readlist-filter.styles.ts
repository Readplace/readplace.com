import { readFileSync } from "node:fs";
import { join } from "node:path";

export const READLIST_FILTER_STYLES = readFileSync(join(__dirname, "readlist-filter.styles.css"), "utf-8");
