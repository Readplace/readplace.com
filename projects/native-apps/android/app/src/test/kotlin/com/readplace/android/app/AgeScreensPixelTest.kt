package com.readplace.android.app

import androidx.activity.ComponentActivity
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import com.readplace.android.core.AgeRefusal
import com.readplace.android.pixel.Appearance
import com.readplace.android.pixel.PIXEL_DEVICE
import com.readplace.android.pixel.PixelCheckpoint
import com.readplace.android.pixel.assertMatchesBaseline
import com.readplace.android.pixel.captureLeaf
import com.readplace.android.testing.ComposeHostActivityRule
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(qualifiers = PIXEL_DEVICE)
class AgeScreensPixelTest {
	@get:Rule(order = 0) val host = ComposeHostActivityRule()

	@get:Rule(order = 1) val compose = createAndroidComposeRule<ComponentActivity>()

	private fun assertRefusal(appearance: Appearance) {
		val capture = compose.captureLeaf(appearance = appearance) {
			AgeRefusedScreen(text = ageRefusalText(AgeRefusal.PARENTAL_APPROVAL_MISSING, serverMessage = null))
		}
		assertMatchesBaseline(
			checkpoint = PixelCheckpoint(suite = "AgeScreensPixelTest", name = "age-refused", appearance = appearance),
			capture = capture,
		)
	}

	private fun assertVerificationPrompt(appearance: Appearance) {
		val capture = compose.captureLeaf(appearance = appearance) {
			AgeVerificationPrompt(onOpenPlay = {}, onDismiss = {})
		}
		assertMatchesBaseline(
			checkpoint = PixelCheckpoint(suite = "AgeScreensPixelTest", name = "age-verification-prompt", appearance = appearance),
			capture = capture,
		)
	}

	@Test
	fun `the refusal looks right in light`() = assertRefusal(Appearance.Light)

	@Test
	fun `the refusal looks right in dark`() = assertRefusal(Appearance.Dark)

	@Test
	fun `the verification prompt looks right in light`() = assertVerificationPrompt(Appearance.Light)

	@Test
	fun `the verification prompt looks right in dark`() = assertVerificationPrompt(Appearance.Dark)
}
