import { readFileSync } from "node:fs";
import { join } from "node:path";

const stylesPath = join(__dirname, "save-error.styles.css");
export const SAVE_ERROR_STYLES = readFileSync(stylesPath, "utf-8");
