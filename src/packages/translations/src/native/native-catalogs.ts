import type { SupportedLocale } from "../locale";

export const NATIVE_CATALOGS = {
	"ios-catalog": {
		purpose: "Every user-facing string of the iOS app and its share extension, in the one String Catalog both targets bundle",
		catalogPath: "projects/native-apps/ios/Shared/Localizable.xcstrings",
		swiftKeysPath: "projects/native-apps/ios/Shared/Copy.swift",
	},
	"android-strings": {
		purpose: "Every user-facing string of the Android app, as Android string and plural resources",
		resDir: "projects/native-apps/android/app/src/main/res",
	},
} as const;

export const NATIVE_LOCALES = {
	"en-US": { ios: "en", android: "values" },
} as const satisfies Record<SupportedLocale, { readonly ios: string; readonly android: string }>;
