package com.readplace.android.app

import androidx.compose.ui.graphics.Color
import com.readplace.android.core.OfflineReading
import com.readplace.android.testing.assertClears
import org.junit.Assert.assertEquals
import org.junit.Test

class BannerToneTest {
	@Test
	fun `only the offline sentence takes the offline tone`() {
		assertEquals(
			listOf(BannerTone.OFFLINE, BannerTone.ERROR),
			listOf(BannerTone.ofError(OfflineReading.BANNER_TEXT), BannerTone.ofError("Server error")),
		)
	}

	@Test
	fun `each tone names its fill and ink in both themes`() {
		for (isDark in listOf(false, true)) {
			val colors = brandColors(isDark)

			assertEquals(
				"isDark=$isDark",
				listOf(
					colors.secondary to colors.textPrimary,
					ERROR_FILL to Color.White,
					colors.secondary to colors.textPrimary,
				),
				BannerTone.entries.map { it.fill(colors) to it.ink(colors) },
			)
		}
	}

	@Test
	fun `every tone but error keeps a surface margin off the list`() {
		val colors = brandColors(isDark = false)

		assertEquals(
			listOf(colors.surface, Color.Transparent, colors.surface),
			BannerTone.entries.map { it.backdrop(colors) },
		)
	}

	@Test
	fun `every banner tone's words read at AA contrast on its fill in both themes`() {
		for (isDark in listOf(false, true)) {
			val colors = brandColors(isDark)
			for (tone in BannerTone.entries) {
				assertClears(ink = tone.ink(colors), ground = tone.fill(colors), floor = 4.5, label = "$tone isDark=$isDark")
			}
		}
	}
}
