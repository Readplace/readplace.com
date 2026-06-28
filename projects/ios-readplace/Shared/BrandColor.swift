import SwiftUI
import UIKit

/// Readplace's brand palette in code — the single source of truth that mirrors
/// the web's design tokens. Values come from `src/packages/web-shell/src/base.styles.ts`
/// (the complete token set the brand guidelines defer to — its table omits some
/// dark-mode variants); each colour adapts to light/dark natively via a dynamic
/// UIColor so views never branch on the colour scheme themselves.
enum BrandColor {
	static let amber = dynamic(light: rgb(200, 112, 42), dark: rgb(212, 131, 58))
	static let highlight = dynamic(light: rgb(200, 146, 60), dark: rgb(212, 160, 74))
	static let success = dynamic(light: rgb(61, 139, 110), dark: rgb(74, 159, 127))
	static let warning = dynamic(light: rgb(200, 146, 60), dark: rgb(212, 160, 74))
	static let error = dynamic(light: rgb(196, 92, 92), dark: rgb(212, 107, 107))

	private static func dynamic(light: UIColor, dark: UIColor) -> UIColor {
		UIColor { trait in trait.userInterfaceStyle == .dark ? dark : light }
	}

	private static func rgb(_ red: Int, _ green: Int, _ blue: Int) -> UIColor {
		UIColor(red: CGFloat(red) / 255, green: CGFloat(green) / 255, blue: CGFloat(blue) / 255, alpha: 1)
	}
}

extension Color {
	static let brandAmber = Color(uiColor: BrandColor.amber)
	static let brandHighlight = Color(uiColor: BrandColor.highlight)
	static let brandSuccess = Color(uiColor: BrandColor.success)
	static let brandWarning = Color(uiColor: BrandColor.warning)
	static let brandError = Color(uiColor: BrandColor.error)
}

extension UIColor {
	static let brandSuccess = BrandColor.success
	static let brandWarning = BrandColor.warning
	static let brandError = BrandColor.error
}
