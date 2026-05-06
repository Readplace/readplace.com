import { readFileSync } from "node:fs";
import { join } from "node:path";

const stylesPath = join(__dirname, "share-balloon.styles.css");
export const SHARE_BALLOON_STYLES = readFileSync(stylesPath, "utf-8");
