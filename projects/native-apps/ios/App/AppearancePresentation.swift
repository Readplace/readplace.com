import SwiftUI

enum AppearancePresentation {
	static func colorScheme(for appearance: String?) -> ColorScheme? {
		switch appearance {
		case "light": return .light
		case "dark": return .dark
		default: return nil
		}
	}
}
