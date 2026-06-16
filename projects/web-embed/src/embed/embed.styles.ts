import { readFileSync } from "node:fs";
import { join } from "node:path";

const stylesPath = join(__dirname, "embed.styles.css");
export const EMBED_PAGE_STYLES = readFileSync(stylesPath, "utf-8");
