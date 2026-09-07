import { readFileSync } from "node:fs";
import { join } from "node:path";

const stylesPath = join(__dirname, "install.styles.css");
export const INSTALL_PAGE_STYLES = readFileSync(stylesPath, "utf-8");
