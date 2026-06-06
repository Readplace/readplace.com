package com.readplace.poc.ui

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

// Brand palette — see BRAND_GUIDELINES.md at the repo root.
private val Navy = Color(0xFF2B3A55)
private val Amber = Color(0xFFC8923C)
private val Brand = Color(0xFFC8702A)
private val Paper = Color(0xFFFFFFFF)
private val Surface = Color(0xFFF7F8FA)
private val Ink = Color(0xFF1A202C)

private val LightColors = lightColorScheme(
	primary = Navy,
	onPrimary = Color.White,
	secondary = Brand,
	onSecondary = Color.White,
	tertiary = Amber,
	background = Paper,
	onBackground = Ink,
	surface = Surface,
	onSurface = Ink,
)

private val DarkColors = darkColorScheme(
	primary = Color(0xFF8DA2C8),
	secondary = Color(0xFFD4833A),
	tertiary = Color(0xFFD4A04A),
)

@Composable
fun ReadplaceTheme(content: @Composable () -> Unit) {
	MaterialTheme(
		colorScheme = if (isSystemInDarkTheme()) DarkColors else LightColors,
		content = content,
	)
}
