import { readFileSync } from "node:fs";
import { join } from "node:path";
import { iconSvg } from "@packages/ui-icons";
import { ARTICLE_HIGHLIGHT_NOTE_END_CLASS } from "./article-highlight-class";

const NOTE_GLYPH_RULE = `.${ARTICLE_HIGHLIGHT_NOTE_END_CLASS}{--article-highlight-note-glyph:url("data:image/svg+xml,${encodeURIComponent(iconSvg("note"))}")}`;

export const HIGHLIGHT_TOOLBAR_STYLES = `${readFileSync(join(__dirname, "highlight-toolbar.styles.css"), "utf-8")}\n${NOTE_GLYPH_RULE}\n`;
