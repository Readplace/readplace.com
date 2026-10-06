import { readFileSync } from "node:fs";
import { join } from "node:path";

const stylesPath = join(__dirname, "queue-digest-mark-read.styles.css");
export const QUEUE_DIGEST_MARK_READ_STYLES = readFileSync(stylesPath, "utf-8");
