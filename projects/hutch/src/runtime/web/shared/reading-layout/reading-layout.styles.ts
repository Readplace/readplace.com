import { readFileSync } from "node:fs";
import { join } from "node:path";

const stylesPath = join(__dirname, "reading-layout.styles.css");
export const READING_LAYOUT_STYLES = readFileSync(stylesPath, "utf-8");
