import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ARTICLE_BODY_STYLES } from "../../shared/article-body/article-body.styles";
import { SHARE_BALLOON_STYLES } from "../../shared/share-balloon/share-balloon.styles";

const stylesPath = join(__dirname, "view.styles.css");
const VIEW_ONLY_STYLES = readFileSync(stylesPath, "utf-8");

export const VIEW_STYLES = `${ARTICLE_BODY_STYLES}\n${SHARE_BALLOON_STYLES}\n${VIEW_ONLY_STYLES}`;
