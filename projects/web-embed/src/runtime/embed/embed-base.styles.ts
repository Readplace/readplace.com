import { readFileSync } from "node:fs";
import { join } from "node:path";

const stylesPath = join(__dirname, "embed-base.styles.css");
export const EMBED_BASE_STYLES = readFileSync(stylesPath, "utf-8");
