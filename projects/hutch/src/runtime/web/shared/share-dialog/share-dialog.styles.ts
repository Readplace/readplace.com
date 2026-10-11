import { readFileSync } from "node:fs";
import { join } from "node:path";

export const SHARE_DIALOG_STYLES = readFileSync(join(__dirname, "share-dialog.styles.css"), "utf-8");
