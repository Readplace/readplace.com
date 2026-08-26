package com.readplace.android.core

import org.junit.Assert.assertEquals
import org.junit.Test

class RedirectHeadersTest {
	@Test
	fun `carries the headers the client sets itself onto the followed request`() {
		val original = mapOf(
			"Authorization" to "Bearer access-1",
			"Accept" to AppConfig.SIREN_MEDIA_TYPE,
			"X-Readplace-Client" to AppConfig.CLIENT_ANDROID,
			AppConfig.SAVE_CONTINUITY_HEADER to AppConfig.SAVE_CONTINUITY_BACKGROUND,
			"User-Agent" to "Readplace/42 Android/16",
		)

		val followed = RedirectHeaders.preserving(from = original, onto = emptyMap())

		assertEquals(
			mapOf(
				"Authorization" to "Bearer access-1",
				"Accept" to AppConfig.SIREN_MEDIA_TYPE,
				"X-Readplace-Client" to AppConfig.CLIENT_ANDROID,
				AppConfig.SAVE_CONTINUITY_HEADER to AppConfig.SAVE_CONTINUITY_BACKGROUND,
				"User-Agent" to "Readplace/42 Android/16",
			),
			followed,
		)
	}

	@Test
	fun `leaves a header the original never set unset`() {
		val followed = RedirectHeaders.preserving(
			from = mapOf("Authorization" to "Bearer access-1"),
			onto = emptyMap(),
		)

		assertEquals(mapOf("Authorization" to "Bearer access-1"), followed)
	}

	@Test
	fun `keeps headers the redirect already carries that are none of ours`() {
		val followed = RedirectHeaders.preserving(
			from = mapOf("Authorization" to "Bearer access-1"),
			onto = mapOf("Content-Type" to "multipart/form-data; boundary=abc"),
		)

		assertEquals(
			mapOf(
				"Authorization" to "Bearer access-1",
				"Content-Type" to "multipart/form-data; boundary=abc",
			),
			followed,
		)
	}

	@Test
	fun `hands the followed request back untouched when the original carried none of ours`() {
		val followed = RedirectHeaders.preserving(
			from = emptyMap(),
			onto = mapOf("Accept" to "text/html"),
		)

		assertEquals(mapOf("Accept" to "text/html"), followed)
	}

	@Test
	fun `replaces a stale value the followed request already carries`() {
		val followed = RedirectHeaders.preserving(
			from = mapOf("Authorization" to "Bearer access-2"),
			onto = mapOf("Authorization" to "Bearer access-1"),
		)

		assertEquals(mapOf("Authorization" to "Bearer access-2"), followed)
	}

	@Test
	fun `carries a header the original sent under a different casing`() {
		val followed = RedirectHeaders.preserving(
			from = mapOf(
				"authorization" to "Bearer access-1",
				"user-agent" to "Readplace/42 Android/16",
			),
			onto = emptyMap(),
		)

		assertEquals(
			mapOf(
				"Authorization" to "Bearer access-1",
				"User-Agent" to "Readplace/42 Android/16",
			),
			followed,
		)
	}

	@Test
	fun `replaces rather than duplicates a header the followed request spells differently`() {
		val followed = RedirectHeaders.preserving(
			from = mapOf("Authorization" to "Bearer access-2"),
			onto = mapOf("authorization" to "Bearer access-1"),
		)

		assertEquals(mapOf("authorization" to "Bearer access-2"), followed)
		assertEquals(1, followed.size)
	}

	@Test
	fun `preserves the four headers the client sets itself plus its user agent`() {
		assertEquals(
			listOf(
				"Authorization",
				"Accept",
				"X-Readplace-Client",
				"X-Readplace-Save-Continuity",
				"User-Agent",
			),
			RedirectHeaders.PRESERVED,
		)
	}
}
