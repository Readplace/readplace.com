package com.readplace.android.core

import org.junit.Assert.assertEquals
import org.junit.Test
import java.time.Duration
import java.time.Instant

class OfflineCopyTest {
	private val now = Instant.parse("2026-11-12T00:00:00Z")

	@Test
	fun `a copy is showable for exactly thirty days`() {
		assertEquals(
			listOf(true, false),
			listOf(
				OfflineCopy.isShowable(savedAt = now.minus(Duration.ofDays(30)), now = now),
				OfflineCopy.isShowable(savedAt = now.minus(Duration.ofDays(30).plusSeconds(1)), now = now),
			),
		)
	}
}
