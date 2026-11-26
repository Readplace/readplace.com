package com.readplace.android.app

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.DeviceConfigurationOverride
import androidx.compose.ui.test.ExperimentalTestApi
import androidx.compose.ui.test.FontScale
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.assert
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.text.TextLayoutResult
import androidx.compose.ui.unit.dp
import com.readplace.android.testing.ComposeHostActivityRule
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

@OptIn(ExperimentalTestApi::class)
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class ReadlistHeaderLayoutTest {
	@get:Rule(order = 0)
	val host = ComposeHostActivityRule()

	@get:Rule(order = 1)
	val compose = createComposeRule()

	private val hint = ReadlistHintContent(text = "Older saves stay elsewhere.", linkLabel = "Open all on the web", url = "https://readplace.test/queue")

	private fun show(label: String) {
		compose.setContent {
			DeviceConfigurationOverride(DeviceConfigurationOverride.FontScale(1.3f)) {
				ReadplaceTheme {
					Column(modifier = Modifier.fillMaxWidth()) {
						ReadlistHeader(label = label, description = "Picked by hand, kept for later.", hint = hint, onOpen = {})
					}
				}
			}
		}
	}

	@Test
	@Config(qualifiers = "w360dp-h640dp-xxhdpi")
	fun `the name, description, hint and link label share the 16dp gutter at a larger font`() {
		show(label = "Hand Picked")

		val gutter = with(compose.density) { 16.dp.toPx() }
		val texts = listOf("Hand Picked", "Picked by hand, kept for later.", "Older saves stay elsewhere.", "Open all on the web")
		assertEquals(texts.associateWith { gutter }, texts.associateWith(::leftEdge))
	}

	@Test
	@Config(qualifiers = "w360dp-h640dp-xxhdpi")
	fun `a 24-character name fits in two lines without overflow at a larger font`() {
		val name = "Weekend Long Reads Queue"
		show(label = name)

		val layout = textLayout(name)
		assertTrue("expected at most 2 lines, got ${layout.lineCount}", layout.lineCount <= 2)
		assertEquals(false, layout.hasVisualOverflow)
	}

	@Test
	@Config(qualifiers = "w360dp-h640dp-xxhdpi")
	fun `the name is a heading`() {
		show(label = "Hand Picked")

		compose.onNodeWithText("Hand Picked", useUnmergedTree = true).assert(SemanticsMatcher.keyIsDefined(SemanticsProperties.Heading))
	}

	private fun leftEdge(text: String): Float =
		compose.onNodeWithText(text, useUnmergedTree = true).fetchSemanticsNode().boundsInRoot.left

	private fun textLayout(text: String): TextLayoutResult {
		val node = compose.onNodeWithText(text, useUnmergedTree = true).fetchSemanticsNode()
		val layouts = mutableListOf<TextLayoutResult>()
		checkNotNull(node.config[SemanticsActions.GetTextLayoutResult].action)(layouts)
		return layouts.single()
	}
}
