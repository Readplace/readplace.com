import { readFileSync } from "node:fs";
import { join } from "node:path";

const stylesPath = join(__dirname, "founding-progress.styles.css");
export const FOUNDING_PROGRESS_STYLES = readFileSync(stylesPath, "utf-8");
