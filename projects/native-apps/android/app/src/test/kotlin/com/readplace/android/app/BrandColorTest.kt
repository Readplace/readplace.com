package com.readplace.android.app

import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * Locks `BrandColor` to the web design tokens that are its source of truth. Each
 * value is resolved for an explicit light and dark scheme and checked against the
 * canonical web hex. A dark variant silently copying its light value (or any other
 * drift from the web tokens) fails here rather than shipping the wrong colour on,
 * e.g., the start-screen wordmark.
 */
class BrandColorTest {
	@Test
	fun `amber mirrors the brand token`() {
		assertHex(BrandColor.amber, light = "#C8702A", dark = "#D4833A")
	}

	@Test
	fun `highlight mirrors the highlight token`() {
		assertHex(BrandColor.highlight, light = "#C8923C", dark = "#D4A04A")
	}

	@Test
	fun `success mirrors the success token`() {
		assertHex(BrandColor.success, light = "#3D8B6E", dark = "#4A9F7F")
	}

	@Test
	fun `warning mirrors the warning token`() {
		assertHex(BrandColor.warning, light = "#C8923C", dark = "#D4A04A")
	}

	@Test
	fun `error mirrors the error token`() {
		assertHex(BrandColor.error, light = "#C45C5C", dark = "#D46B6B")
	}

	@Test
	fun `splash background mirrors the dark neutral token`() {
		assertEquals("#121212", hex(BrandColor.splashBackground))
	}

	private fun assertHex(pair: BrandColorPair, light: String, dark: String) {
		assertEquals("light", light, hex(pair.resolve(isDark = false)))
		assertEquals("dark", dark, hex(pair.resolve(isDark = true)))
	}

	private fun hex(rgb: Rgb): String = "#%02X%02X%02X".format(rgb.red, rgb.green, rgb.blue)
}
