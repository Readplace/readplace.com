import { readFileSync } from "node:fs";
import { join } from "node:path";

const stylesPath = join(__dirname, "disclosure-card.styles.css");
export const DISCLOSURE_CARD_STYLES = readFileSync(stylesPath, "utf-8");
