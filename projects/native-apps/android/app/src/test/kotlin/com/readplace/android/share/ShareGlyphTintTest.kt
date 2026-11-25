package com.readplace.android.share

import com.readplace.android.app.brandColors
import com.readplace.android.testing.assertClears
import org.junit.Test

class ShareGlyphTintTest {
	@Test
	fun `the share sheet's status glyphs clear 3 to 1 on the card in both themes`() {
		for (isDark in listOf(false, true)) {
			val colors = brandColors(isDark)
			for (tone in ShareStatusTone.entries) {
				assertClears(ink = shareGlyphTint(tone, colors, isDark), ground = colors.surface, floor = 3.0, label = "$tone isDark=$isDark")
			}
		}
	}
}
