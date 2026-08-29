import SwiftUI
import UIKit

/// Readplace's brand palette in code.
/// Each colour adapts to light/dark natively via a dynamic UIColor so views never
/// branch on the colour scheme themselves.
enum BrandColor {
	static let amber = dynamic(light: rgb(200, 112, 42), dark: rgb(212, 131, 58))
	static let highlight = dynamic(light: rgb(200, 146, 60), dark: rgb(212, 160, 74))
	static let success = dynamic(light: rgb(61, 139, 110), dark: rgb(74, 159, 127))
	static let warning = dynamic(light: rgb(200, 146, 60), dark: rgb(212, 160, 74))
	static let error = dynamic(light: rgb(196, 92, 92), dark: rgb(212, 107, 107))
	static let splashBackground = rgb(18, 18, 18)
	static let surface = dynamic(light: rgb(255, 255, 255), dark: rgb(18, 18, 18))
	static let surfaceSubtle = dynamic(light: rgb(247, 248, 250), dark: rgb(26, 26, 26))
	static let textPrimary = dynamic(light: rgb(26, 32, 44), dark: rgb(228, 228, 228))
	static let textSecondary = dynamic(light: rgb(90, 97, 112), dark: rgb(155, 161, 174))
	static let textMuted = dynamic(light: rgb(140, 145, 157), dark: rgb(107, 107, 107))
	static let border = dynamic(light: rgb(226, 229, 234), dark: rgb(46, 46, 46))
	static let card = dynamic(light: rgb(255, 255, 255), dark: rgb(34, 34, 34))
	static let secondary = dynamic(light: rgb(246, 242, 238), dark: rgb(53, 45, 39))
	static let primaryText = dynamic(light: rgb(168, 90, 30), dark: rgb(218, 141, 78))
	static let successText = dynamic(light: rgb(54, 124, 99), dark: rgb(74, 159, 127))

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
	static let brandSplashBackground = Color(uiColor: BrandColor.splashBackground)
	static let brandSurface = Color(uiColor: BrandColor.surface)
	static let brandSurfaceSubtle = Color(uiColor: BrandColor.surfaceSubtle)
	static let brandTextPrimary = Color(uiColor: BrandColor.textPrimary)
	static let brandTextSecondary = Color(uiColor: BrandColor.textSecondary)
	static let brandTextMuted = Color(uiColor: BrandColor.textMuted)
	static let brandBorder = Color(uiColor: BrandColor.border)
	static let brandCard = Color(uiColor: BrandColor.card)
	static let brandSecondary = Color(uiColor: BrandColor.secondary)
	static let brandPrimaryText = Color(uiColor: BrandColor.primaryText)
	static let brandSuccessText = Color(uiColor: BrandColor.successText)
}

extension UIColor {
	static let brandSuccess = BrandColor.success
	static let brandWarning = BrandColor.warning
	static let brandError = BrandColor.error
	static let brandSurface = BrandColor.surface
	static let brandTextPrimary = BrandColor.textPrimary
	static let brandTextSecondary = BrandColor.textSecondary
}
