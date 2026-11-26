package com.readplace.android.app

import org.junit.Assert.assertEquals
import org.junit.Test

class AffordanceTintColorsTest {
	@Test
	fun `a menu label takes the ink token and a toolbar glyph keeps the mark`() {
		for (isDark in listOf(false, true)) {
			val colors = brandColors(isDark)

			assertEquals(
				listOf(
					null to null,
					colors.successText to colors.success,
					colors.errorText to colors.error,
				),
				AffordanceTint.entries.map { it.ink(colors) to it.fill(colors) },
			)
		}
	}
}
