package com.readplace.android.app

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color

/** The palette resolved for the colour scheme in force, read by screens through
 * [LocalBrandColors] so no view branches on light/dark itself. */
data class BrandColors(
	val amber: Color,
	val highlight: Color,
	val success: Color,
	val warning: Color,
	val error: Color,
	val splashBackground: Color,
)

private fun Rgb.toColor(): Color = Color(red = red, green = green, blue = blue)

fun brandColors(isDark: Boolean): BrandColors =
	BrandColors(
		amber = BrandColor.amber.resolve(isDark).toColor(),
		highlight = BrandColor.highlight.resolve(isDark).toColor(),
		success = BrandColor.success.resolve(isDark).toColor(),
		warning = BrandColor.warning.resolve(isDark).toColor(),
		error = BrandColor.error.resolve(isDark).toColor(),
		splashBackground = BrandColor.splashBackground.toColor(),
	)

val LocalBrandColors = staticCompositionLocalOf { brandColors(isDark = false) }

@Composable
fun ReadplaceTheme(content: @Composable () -> Unit) {
	val isDark = isSystemInDarkTheme()
	val brand = brandColors(isDark)
	val scheme = if (isDark) {
		darkColorScheme(primary = brand.amber, secondary = brand.highlight, error = brand.error)
	} else {
		lightColorScheme(primary = brand.amber, secondary = brand.highlight, error = brand.error)
	}
	androidx.compose.runtime.CompositionLocalProvider(LocalBrandColors provides brand) {
		MaterialTheme(colorScheme = scheme, content = content)
	}
}
