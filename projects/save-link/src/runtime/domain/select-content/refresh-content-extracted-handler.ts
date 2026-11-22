import { initSelectionQueueHandler } from "./select-content-work";
import { SELECTION_SOURCE_POLICIES } from "./selection-source-policies";

export const initRefreshContentExtractedHandler = initSelectionQueueHandler(SELECTION_SOURCE_POLICIES["refresh-content-extracted"]);
