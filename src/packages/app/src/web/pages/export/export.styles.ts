import { readFileSync } from "node:fs";
import { join } from "node:path";

const stylesPath = join(__dirname, "export.styles.css");
export const EXPORT_STYLES = readFileSync(stylesPath, "utf-8");
