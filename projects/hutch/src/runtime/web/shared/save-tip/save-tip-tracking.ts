export const SAVE_TIP_UTM_SOURCE = "save-tip";

export const SAVE_TIP_ELEMENTS = {
	opened: "opened",
	acknowledged: "acknowledged",
	dismissed: "dismissed",
	install: "install",
} as const;

export type SaveTipElement = (typeof SAVE_TIP_ELEMENTS)[keyof typeof SAVE_TIP_ELEMENTS];

export const SAVE_TIP_EVENT_PATH = "/save-tip/event";
