import { readFileSync } from "node:fs";
import { join } from "node:path";

const stylesPath = join(__dirname, "newsletter.styles.css");
export const NEWSLETTER_STYLES = readFileSync(stylesPath, "utf-8");
