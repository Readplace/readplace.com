import { readFileSync } from "node:fs";
import { join } from "node:path";

const stylesPath = join(__dirname, "past-reads.styles.css");
export const PAST_READS_STYLES = readFileSync(stylesPath, "utf-8");
