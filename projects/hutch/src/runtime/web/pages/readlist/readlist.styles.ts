import { readFileSync } from "node:fs";
import { join } from "node:path";

const stylesPath = join(__dirname, "readlist.styles.css");
export const READLIST_STYLES = readFileSync(stylesPath, "utf-8");
