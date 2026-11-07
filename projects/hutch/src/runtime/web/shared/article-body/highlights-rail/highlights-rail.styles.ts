import { readFileSync } from "node:fs";
import { join } from "node:path";

export const HIGHLIGHTS_RAIL_STYLES = readFileSync(join(__dirname, "highlights-rail.styles.css"), "utf-8");
