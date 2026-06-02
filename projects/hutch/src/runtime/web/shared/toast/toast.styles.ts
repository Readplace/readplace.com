import { readFileSync } from "node:fs";
import { join } from "node:path";

const stylesPath = join(__dirname, "toast.styles.css");
export const TOAST_STYLES = readFileSync(stylesPath, "utf-8");
