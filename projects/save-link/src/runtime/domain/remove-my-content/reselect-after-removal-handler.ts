import { initSelectionQueueHandler } from "../select-content/select-content-work";
import { SELECTION_SOURCE_POLICIES } from "../select-content/selection-source-policies";

export const initReselectAfterRemovalHandler = initSelectionQueueHandler(SELECTION_SOURCE_POLICIES["reselect-after-removal"]);
