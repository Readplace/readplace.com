import { readFileSync } from "node:fs";
import { join } from "node:path";

const stylesPath = join(__dirname, "readlist-preferences.styles.css");
export const READLIST_PREFERENCES_STYLES = readFileSync(stylesPath, "utf-8");
