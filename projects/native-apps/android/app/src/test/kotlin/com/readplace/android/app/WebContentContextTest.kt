package com.readplace.android.app

import android.util.TypedValue
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment

@RunWith(RobolectricTestRunner::class)
class WebContentContextTest {
	private fun declaresLightTheme(isDark: Boolean): Boolean {
		val attribute = TypedValue()
		val declared = webContentContext(RuntimeEnvironment.getApplication(), isDark)
			.theme
			.resolveAttribute(android.R.attr.isLightTheme, attribute, true)

		assertTrue("isLightTheme must be declared — WebView reads it to answer prefers-color-scheme", declared)
		return attribute.data != 0
	}

	@Test
	fun `a light system puts the web view's pages on their light scheme`() {
		assertEquals(true, declaresLightTheme(isDark = false))
	}

	@Test
	fun `a dark system puts the web view's pages on their dark scheme`() {
		assertEquals(false, declaresLightTheme(isDark = true))
	}
}
