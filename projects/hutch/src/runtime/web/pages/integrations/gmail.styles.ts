import { readFileSync } from "node:fs";
import { join } from "node:path";

const stylesPath = join(__dirname, "gmail.styles.css");
export const GMAIL_PAGE_STYLES = readFileSync(stylesPath, "utf-8");
