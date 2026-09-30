import { readFileSync } from "node:fs";
import { join } from "node:path";

const stylesPath = join(__dirname, "queue-digest-unsubscribe.styles.css");
export const QUEUE_DIGEST_UNSUBSCRIBE_STYLES = readFileSync(stylesPath, "utf-8");
