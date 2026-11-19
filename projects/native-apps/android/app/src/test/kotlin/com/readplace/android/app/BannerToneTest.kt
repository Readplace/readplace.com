package com.readplace.android.app

import androidx.compose.ui.graphics.Color
import com.readplace.android.core.OfflineReading
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
	fun `each tone names its fill and ink from the palette`() {
		val colors = brandColors(isDark = false)

		assertEquals(
			listOf(
				colors.secondary to colors.textPrimary,
				colors.error to Color.White,
				colors.warning to Color.White,
			),
			BannerTone.entries.map { it.fill(colors) to it.ink(colors) },
		)
	}
}
