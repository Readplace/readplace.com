import { readFileSync } from "node:fs";
import { join } from "node:path";

const stylesPath = join(__dirname, "next-read.styles.css");
export const NEXT_READ_STYLES = readFileSync(stylesPath, "utf-8");
