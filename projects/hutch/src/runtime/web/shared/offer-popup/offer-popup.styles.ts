import { readFileSync } from "node:fs";
import { join } from "node:path";

const stylesPath = join(__dirname, "offer-popup.styles.css");
export const OFFER_POPUP_STYLES = readFileSync(stylesPath, "utf-8");
