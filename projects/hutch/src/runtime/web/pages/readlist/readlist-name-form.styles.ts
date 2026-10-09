import { readFileSync } from "node:fs";
import { join } from "node:path";

const stylesPath = join(__dirname, "readlist-name-form.styles.css");
export const READLIST_NAME_FORM_STYLES = readFileSync(stylesPath, "utf-8");
