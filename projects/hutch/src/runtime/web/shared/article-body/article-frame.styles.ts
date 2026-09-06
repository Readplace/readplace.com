import { readFileSync } from "node:fs";
import { join } from "node:path";

const stylesPath = join(__dirname, "article-frame.styles.css");

export const ARTICLE_FRAME_STYLES = readFileSync(stylesPath, "utf-8");
