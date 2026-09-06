package com.readplace.android.app

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class AppearancePresentationTest {
	@Test
	fun `light and dark preferences pin their scheme regardless of the OS setting`() {
		assertFalse(AppearancePresentation.isDark("light", systemInDarkTheme = true))
		assertTrue(AppearancePresentation.isDark("dark", systemInDarkTheme = false))
	}

	@Test
	fun `system, unknown, and absent preferences follow the OS setting`() {
		assertTrue(AppearancePresentation.isDark("system", systemInDarkTheme = true))
		assertFalse(AppearancePresentation.isDark("chartreuse", systemInDarkTheme = false))
		assertFalse(AppearancePresentation.isDark(null, systemInDarkTheme = false))
	}
}
