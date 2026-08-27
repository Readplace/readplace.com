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

	@Test
	fun `surface mirrors the background token`() {
		assertHex(BrandColor.surface, light = "#FFFFFF", dark = "#121212")
	}

	@Test
	fun `surface subtle mirrors the surface token`() {
		assertHex(BrandColor.surfaceSubtle, light = "#F7F8FA", dark = "#1A1A1A")
	}

	@Test
	fun `text primary mirrors the primary text token`() {
		assertHex(BrandColor.textPrimary, light = "#1A202C", dark = "#E4E4E4")
	}

	@Test
	fun `text secondary mirrors the secondary text token`() {
		assertHex(BrandColor.textSecondary, light = "#5A6170", dark = "#9BA1AE")
	}

	@Test
	fun `text muted mirrors the muted text token`() {
		assertHex(BrandColor.textMuted, light = "#8C919D", dark = "#6B6B6B")
	}

	@Test
	fun `border mirrors the border token`() {
		assertHex(BrandColor.border, light = "#E2E5EA", dark = "#2E2E2E")
	}

	@Test
	fun `amber container mirrors the brand light token`() {
		assertHex(BrandColor.amberContainer, light = "#F5E6D3", dark = "#3D2A18")
	}

	@Test
	fun `on amber container mirrors the brand dark token`() {
		assertHex(BrandColor.onAmberContainer, light = "#A85A1E", dark = "#E89A55")
	}

	private fun assertHex(pair: BrandColorPair, light: String, dark: String) {
		assertEquals("light", light, hex(pair.resolve(isDark = false)))
		assertEquals("dark", dark, hex(pair.resolve(isDark = true)))
	}

	private fun hex(rgb: Rgb): String = "#%02X%02X%02X".format(rgb.red, rgb.green, rgb.blue)
}
