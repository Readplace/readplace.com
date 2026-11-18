package com.readplace.android.app

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
}
