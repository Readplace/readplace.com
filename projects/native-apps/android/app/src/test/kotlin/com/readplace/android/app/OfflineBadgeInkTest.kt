package com.readplace.android.app

import androidx.compose.ui.graphics.compositeOver
import com.readplace.android.testing.assertClears
import org.junit.Test

class OfflineBadgeInkTest {
	@Test
	fun `the offline badge's words read at AA contrast on read and unread rows in both themes`() {
		for (isDark in listOf(false, true)) {
			val colors = brandColors(isDark)
			for (row in listOf(colors.card, colors.secondary)) {
				val ground = colors.success.copy(alpha = 0.12f).compositeOver(row)
				assertClears(ink = offlineBadgeInk(isDark), ground = ground, floor = 4.5, label = "isDark=$isDark row=$row")
			}
		}
	}
}
