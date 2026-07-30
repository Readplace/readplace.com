import { readFileSync } from "node:fs";
import { join } from "node:path";

const stylesPath = join(__dirname, "my-readplace.styles.css");
export const MY_READPLACE_STYLES = readFileSync(stylesPath, "utf-8");
