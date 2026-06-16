import { readFileSync } from "node:fs";
import { join } from "node:path";

const stylesPath = join(__dirname, "preview.styles.css");
export const PREVIEW_PAGE_STYLES = readFileSync(stylesPath, "utf-8");
