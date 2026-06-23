import { readFileSync } from "node:fs";
import { join } from "node:path";

const stylesPath = join(__dirname, "inbox.styles.css");
export const INBOX_STYLES = readFileSync(stylesPath, "utf-8");
