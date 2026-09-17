import { readFileSync } from "node:fs";
import { join } from "node:path";

const stylesPath = join(__dirname, "readlist-design.styles.css");
export const READLIST_DESIGN_STYLES = readFileSync(stylesPath, "utf-8");
