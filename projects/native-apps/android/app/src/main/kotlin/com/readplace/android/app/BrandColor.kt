package com.readplace.android.app

data class Rgb(val red: Int, val green: Int, val blue: Int)

data class BrandColorPair(val light: Rgb, val dark: Rgb) {
	fun resolve(isDark: Boolean): Rgb = if (isDark) dark else light
}

/**
 * Readplace's brand palette in code.
 * Each colour carries its light and dark variant so the theme resolves it once and
 * views never branch on the colour scheme themselves.
 */
object BrandColor {
	val amber = BrandColorPair(
		light = Rgb(red = 200, green = 112, blue = 42),
		dark = Rgb(red = 212, green = 131, blue = 58),
	)
	val highlight = BrandColorPair(
		light = Rgb(red = 200, green = 146, blue = 60),
		dark = Rgb(red = 212, green = 160, blue = 74),
	)
	val success = BrandColorPair(
		light = Rgb(red = 61, green = 139, blue = 110),
		dark = Rgb(red = 74, green = 159, blue = 127),
	)
	val warning = BrandColorPair(
		light = Rgb(red = 200, green = 146, blue = 60),
		dark = Rgb(red = 212, green = 160, blue = 74),
	)
	val error = BrandColorPair(
		light = Rgb(red = 196, green = 92, blue = 92),
		dark = Rgb(red = 212, green = 107, blue = 107),
	)
	val splashBackground = Rgb(red = 18, green = 18, blue = 18)
	val surface = BrandColorPair(
		light = Rgb(red = 255, green = 255, blue = 255),
		dark = Rgb(red = 18, green = 18, blue = 18),
	)
	val surfaceSubtle = BrandColorPair(
		light = Rgb(red = 247, green = 248, blue = 250),
		dark = Rgb(red = 26, green = 26, blue = 26),
	)
	val textPrimary = BrandColorPair(
		light = Rgb(red = 26, green = 32, blue = 44),
		dark = Rgb(red = 228, green = 228, blue = 228),
	)
	val textSecondary = BrandColorPair(
		light = Rgb(red = 90, green = 97, blue = 112),
		dark = Rgb(red = 155, green = 161, blue = 174),
	)
	val textMuted = BrandColorPair(
		light = Rgb(red = 140, green = 145, blue = 157),
		dark = Rgb(red = 107, green = 107, blue = 107),
	)
	val border = BrandColorPair(
		light = Rgb(red = 226, green = 229, blue = 234),
		dark = Rgb(red = 46, green = 46, blue = 46),
	)
	val amberContainer = BrandColorPair(
		light = Rgb(red = 245, green = 230, blue = 211),
		dark = Rgb(red = 61, green = 42, blue = 24),
	)
	val onAmberContainer = BrandColorPair(
		light = Rgb(red = 168, green = 90, blue = 30),
		dark = Rgb(red = 232, green = 154, blue = 85),
	)
}
