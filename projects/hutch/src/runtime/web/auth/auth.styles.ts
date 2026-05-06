import { readFileSync } from "node:fs";
import { join } from "node:path";
import { FOUNDING_PROGRESS_STYLES } from "../shared/founding-progress/founding-progress.styles";

const stylesPath = join(__dirname, "auth.styles.css");
export const AUTH_STYLES = `${readFileSync(stylesPath, "utf-8")}\n${FOUNDING_PROGRESS_STYLES}`;
