import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ARTICLE_BODY_STYLES } from "../../shared/article-body/article-body.styles";
import { READING_LAYOUT_STYLES } from "../../shared/reading-layout/reading-layout.styles";
import { HIGHLIGHT_NOTE_STYLES } from "../../shared/article-body/highlights/highlight-note.styles";
import { HIGHLIGHT_TOOLBAR_STYLES } from "../../shared/article-body/highlights/highlight-toolbar.styles";
import { HIGHLIGHTS_RAIL_STYLES } from "../../shared/article-body/highlights-rail/highlights-rail.styles";
import { READLIST_NAME_FORM_STYLES } from "../readlist/readlist-name-form.styles";
import { VIEW_HIGHLIGHTS_STYLES } from "./view-highlights.component";

const stylesPath = join(__dirname, "view.styles.css");
const VIEW_ONLY_STYLES = readFileSync(stylesPath, "utf-8");

export const VIEW_STYLES = `${ARTICLE_BODY_STYLES}\n${READING_LAYOUT_STYLES}\n${VIEW_ONLY_STYLES}\n${HIGHLIGHTS_RAIL_STYLES}\n${HIGHLIGHT_TOOLBAR_STYLES}\n${HIGHLIGHT_NOTE_STYLES}\n${READLIST_NAME_FORM_STYLES}\n${VIEW_HIGHLIGHTS_STYLES}`;
