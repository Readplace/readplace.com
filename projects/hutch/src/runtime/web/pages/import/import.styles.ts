import { readFileSync } from "node:fs";
import { join } from "node:path";

const stylesPath = join(__dirname, "import.styles.css");
export const IMPORT_STYLES = readFileSync(stylesPath, "utf-8");
