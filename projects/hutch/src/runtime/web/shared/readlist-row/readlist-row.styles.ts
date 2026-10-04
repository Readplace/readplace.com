import { readFileSync } from "node:fs";
import { join } from "node:path";

const stylesPath = join(__dirname, "readlist-row.styles.css");
export const READLIST_ROW_STYLES = readFileSync(stylesPath, "utf-8");
