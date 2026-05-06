import { readFileSync } from "node:fs";
import { join } from "node:path";

const stylesPath = join(__dirname, "article-body.styles.css");
export const ARTICLE_BODY_STYLES = readFileSync(stylesPath, "utf-8");
