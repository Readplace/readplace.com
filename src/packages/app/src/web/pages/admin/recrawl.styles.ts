import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ARTICLE_BODY_STYLES } from "../../shared/article-body/article-body.styles";

const stylesPath = join(__dirname, "recrawl.styles.css");
const RECRAWL_ONLY_STYLES = readFileSync(stylesPath, "utf-8");

export const RECRAWL_STYLES = `${ARTICLE_BODY_STYLES}\n${RECRAWL_ONLY_STYLES}`;
