import { readFileSync } from "node:fs";
import { join } from "node:path";

export const ARTICLE_DELETE_STYLES = readFileSync(join(__dirname, "article-delete.styles.css"), "utf-8");
