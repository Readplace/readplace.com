package com.readplace.android.app

import androidx.activity.ComponentActivity
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import com.readplace.android.pixel.Appearance
import com.readplace.android.pixel.PIXEL_DEVICE
import com.readplace.android.pixel.PixelCheckpoint
import com.readplace.android.pixel.assertMatchesBaseline
import com.readplace.android.pixel.captureLeaf
import com.readplace.android.testing.ComposeHostActivityRule
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(qualifiers = PIXEL_DEVICE)
class LoginMarksPixelTest {
	@get:Rule(order = 0) val host = ComposeHostActivityRule()

	@get:Rule(order = 1) val compose = createAndroidComposeRule<ComponentActivity>()

	private fun assertMuteButton(isMuted: Boolean, name: String) {
		val capture = compose.captureLeaf(appearance = Appearance.Light) {
			MuteButton(isMuted = isMuted, onToggle = {})
		}
		val fill = capture.argb[4 * capture.width + 22]
		val channels = listOf((fill shr 16) and 0xFF, (fill shr 8) and 0xFF, fill and 0xFF)
		assertTrue("fill channels $channels are #737373 within 1", channels.all { it in 114..116 })
		assertMatchesBaseline(
			checkpoint = PixelCheckpoint(suite = "LoginMarksPixelTest", name = name, appearance = Appearance.Light),
			capture = capture,
		)
	}

	@Test
	fun `the wordmark tail is brand amber`() {
		val capture = compose.captureLeaf(appearance = Appearance.Light) { LoginWordmark() }
		assertTrue("the wordmark draws #C8702A", capture.argb.contains(0xFFC8702A.toInt()))
		assertMatchesBaseline(
			checkpoint = PixelCheckpoint(suite = "LoginMarksPixelTest", name = "login-wordmark", appearance = Appearance.Light),
			capture = capture,
		)
	}

	@Test
	fun `the mute button fill is 55 percent black over white`() = assertMuteButton(isMuted = false, name = "mute-button")

	@Test
	fun `the muted button keeps the same fill`() = assertMuteButton(isMuted = true, name = "mute-button-muted")
}
