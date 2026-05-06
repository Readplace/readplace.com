import { readFileSync } from "node:fs";
import { join } from "node:path";
import { FOUNDING_PROGRESS_STYLES } from "../../shared/founding-progress/founding-progress.styles";

const stylesPath = join(__dirname, "home.styles.css");
export const HOME_PAGE_STYLES = `${readFileSync(stylesPath, "utf-8")}\n${FOUNDING_PROGRESS_STYLES}`;
