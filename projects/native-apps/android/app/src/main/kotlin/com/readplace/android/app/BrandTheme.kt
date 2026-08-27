package com.readplace.android.app

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.ColorScheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Shapes
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp

/** The palette resolved for the colour scheme in force, read by screens through
 * [LocalBrandColors] so no view branches on light/dark itself. */
data class BrandColors(
	val amber: Color,
	val highlight: Color,
	val success: Color,
	val warning: Color,
	val error: Color,
	val splashBackground: Color,
	val surface: Color,
	val surfaceSubtle: Color,
	val textPrimary: Color,
	val textSecondary: Color,
	val textMuted: Color,
	val border: Color,
	val amberContainer: Color,
	val onAmberContainer: Color,
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
		surface = BrandColor.surface.resolve(isDark).toColor(),
		surfaceSubtle = BrandColor.surfaceSubtle.resolve(isDark).toColor(),
		textPrimary = BrandColor.textPrimary.resolve(isDark).toColor(),
		textSecondary = BrandColor.textSecondary.resolve(isDark).toColor(),
		textMuted = BrandColor.textMuted.resolve(isDark).toColor(),
		border = BrandColor.border.resolve(isDark).toColor(),
		amberContainer = BrandColor.amberContainer.resolve(isDark).toColor(),
		onAmberContainer = BrandColor.onAmberContainer.resolve(isDark).toColor(),
	)

private fun brandScheme(brand: BrandColors, isDark: Boolean): ColorScheme =
	(if (isDark) darkColorScheme() else lightColorScheme()).copy(
		primary = brand.amber,
		onPrimary = Color.White,
		surfaceTint = brand.amber,
		secondary = brand.highlight,
		secondaryContainer = brand.amberContainer,
		onSecondaryContainer = brand.onAmberContainer,
		error = brand.error,
		background = brand.surface,
		onBackground = brand.textPrimary,
		surface = brand.surface,
		onSurface = brand.textPrimary,
		surfaceVariant = brand.surfaceSubtle,
		onSurfaceVariant = brand.textSecondary,
		surfaceContainerLowest = brand.surface,
		surfaceContainerLow = brand.surface,
		surfaceContainer = brand.surfaceSubtle,
		surfaceContainerHigh = brand.surfaceSubtle,
		surfaceContainerHighest = brand.border,
		outline = brand.textMuted,
		outlineVariant = brand.border,
	)

private val brandShapes = Shapes(small = RoundedCornerShape(6.dp))

val LocalBrandColors = staticCompositionLocalOf { brandColors(isDark = false) }

@Composable
fun ReadplaceTheme(content: @Composable () -> Unit) {
	val isDark = isSystemInDarkTheme()
	val brand = brandColors(isDark)
	androidx.compose.runtime.CompositionLocalProvider(LocalBrandColors provides brand) {
		MaterialTheme(colorScheme = brandScheme(brand, isDark), shapes = brandShapes, content = content)
	}
}
