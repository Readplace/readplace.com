import { readFileSync } from "node:fs";
import { join } from "node:path";

const stylesPath = join(__dirname, "upload-dropzone.styles.css");
export const UPLOAD_DROPZONE_STYLES = readFileSync(stylesPath, "utf-8");
