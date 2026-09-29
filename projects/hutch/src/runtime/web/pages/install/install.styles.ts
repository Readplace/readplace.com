import { readFileSync } from "node:fs";
import { join } from "node:path";
import { UNDERLINE_TABS_STYLES } from "@packages/web-shell";

const stylesPath = join(__dirname, "install.styles.css");
export const INSTALL_PAGE_STYLES = `${UNDERLINE_TABS_STYLES}\n${readFileSync(stylesPath, "utf-8")}`;
