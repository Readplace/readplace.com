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
}
