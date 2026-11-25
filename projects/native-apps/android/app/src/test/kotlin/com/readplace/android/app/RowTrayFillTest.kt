package com.readplace.android.app

import androidx.compose.ui.graphics.Color
import com.readplace.android.testing.assertClears
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class RowTrayFillTest {
	@Test
	fun `the swipe tray's white labels read at AA contrast on each tinted fill`() {
		assertNull(AffordanceTint.NEUTRAL.trayFill())
		for (tint in listOf(AffordanceTint.SUCCESS, AffordanceTint.DESTRUCTIVE)) {
			val fill = requireNotNull(tint.trayFill())
			assertClears(ink = Color.White, ground = fill, floor = 4.5, label = "$tint")
		}
	}

	@Test
	fun `the delete tray and the error banner share one fill`() {
		assertEquals(BannerTone.ERROR.fill(brandColors(isDark = false)), AffordanceTint.DESTRUCTIVE.trayFill())
	}
}
