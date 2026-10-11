import { readFileSync } from "node:fs";
import { join } from "node:path";

const stylesPath = join(__dirname, "sender-popover.styles.css");

export const SENDER_POPOVER_STYLES = readFileSync(stylesPath, "utf-8");
