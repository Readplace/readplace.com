import { readFileSync } from "node:fs";
import { join } from "node:path";

const stylesPath = join(__dirname, "queue.styles.css");
export const QUEUE_STYLES = readFileSync(stylesPath, "utf-8");
