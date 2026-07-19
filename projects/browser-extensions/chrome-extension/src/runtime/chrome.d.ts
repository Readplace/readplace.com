declare namespace chrome {
	namespace offscreen {
		type Reason =
			| "TESTING"
			| "AUDIO_PLAYBACK"
			| "IFRAME_SCRIPTING"
			| "DOM_SCRAPING"
			| "BLOBS"
			| "DOM_PARSER"
			| "MEDIA_STREAM"
			| "DISPLAY_MEDIA"
			| "WEB_RTC"
			| "CLIPBOARD"
			| "LOCAL_STORAGE"
			| "WORKERS"
			| "BATTERY_STATUS"
			| "MATCH_MEDIA"
			| "GEOLOCATION"
			| "USER_MEDIA"
			| "NOTIFICATIONS"
			| "CANVAS";

		function createDocument(parameters: {
			url: string;
			reasons: Reason[];
			justification: string;
		}): Promise<void>;

		function hasDocument(): Promise<boolean>;
	}
}
