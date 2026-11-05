import { readFileSync } from "node:fs";
import { join } from "node:path";

const stylesPath = join(__dirname, "readlist-keep-offer.styles.css");
export const READLIST_KEEP_OFFER_STYLES = readFileSync(stylesPath, "utf-8");
