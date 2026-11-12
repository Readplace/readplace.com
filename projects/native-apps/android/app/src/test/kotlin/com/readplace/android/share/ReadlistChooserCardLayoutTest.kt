package com.readplace.android.share

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.semantics.getOrNull
import androidx.compose.ui.test.DeviceConfigurationOverride
import androidx.compose.ui.test.ExperimentalTestApi
import androidx.compose.ui.test.FontScale
import androidx.compose.ui.test.SemanticsNodeInteraction
import androidx.compose.ui.test.assertHeightIsAtLeast
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.getUnclippedBoundsInRoot
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.hasScrollAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.isSelectable
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.text.TextLayoutResult
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.height
import androidx.compose.ui.unit.width
import com.readplace.android.app.ReadplaceTheme
import com.readplace.android.core.Readlist
import com.readplace.android.core.SharedArticlesDrop
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
class ReadlistChooserCardLayoutTest {
	@get:Rule(order = 0)
	val host = ComposeHostActivityRule()

	@get:Rule(order = 1)
	val compose = createComposeRule()

	@Test
	@Config(qualifiers = PORTRAIT)
	fun `the harness applies the window and font scale to real text`() {
		var scale by mutableFloatStateOf(1f)
		val sheet = ShareSheetState().apply { chooserDrops = fullList() }
		compose.setContent {
			DeviceConfigurationOverride(DeviceConfigurationOverride.FontScale(scale)) {
				ReadplaceTheme { ShareSheet(sheet = sheet, onDismiss = {}, onEnded = {}) }
			}
		}

		val root = compose.onRoot().getUnclippedBoundsInRoot()
		assertEquals(320.dp to 568.dp, root.width to root.height)

		val title = compose.onNode(hasText(TITLE), useUnmergedTree = true)
		val atDefault = title.getUnclippedBoundsInRoot().height
		scale = 2f
		compose.waitForIdle()
		val atLargest = title.getUnclippedBoundsInRoot().height

		assertTrue("title $atDefault at 1.0 should grow at 2.0, was $atLargest", atLargest > atDefault)
	}

	@Test
	@Config(qualifiers = PORTRAIT)
	fun `every row and Done meet the 48dp touch target on the narrowest window`() {
		render(fullList(), fontScale = 1f)

		val heights = rowHeights()
		assertEquals(FULL_LIST_LABELS.toSet(), heights.keys)
		assertEquals(
			"row heights $heights",
			heights.mapValues { true },
			heights.mapValues { (_, height) -> height >= TOUCH_TARGET },
		)
		assertTouchHeightIsAtLeastTarget(done())
		assertDoneUnsqueezedAndOnScreen()
	}

	@Test
	@Config(qualifiers = PORTRAIT)
	fun `Done keeps its touch target at the smallest font`() {
		render(fullList(), fontScale = 0.85f)

		assertTouchHeightIsAtLeastTarget(done())
		done().assertHeightIsAtLeast(BUTTON_HEIGHT)
	}

	@Test
	@Config(qualifiers = PORTRAIT)
	fun `Done stays reachable at the largest font while the list yields`() {
		render(fullList(), fontScale = 2f)

		assertDoneUnsqueezedAndOnScreen()
		assertListScrolls()
		compose.onNode(hasText("Readlist 7"), useUnmergedTree = true).performScrollTo().assertIsDisplayed()

		val texts = listOf(TITLE, CAPTION, LONG_LABEL, "Done")
		assertEquals(
			texts.associateWith { false },
			texts.associateWith { overflows(compose.onNode(hasText(it), useUnmergedTree = true)) },
		)
	}

	@Test
	@Config(qualifiers = LANDSCAPE)
	fun `Done stays reachable in landscape with a full list`() {
		render(fullList(), fontScale = 1f)

		assertDoneUnsqueezedAndOnScreen()
		compose.onNode(hasText(TITLE), useUnmergedTree = true).assertIsDisplayed()
		assertListScrolls()
	}

	@Test
	@Config(qualifiers = PORTRAIT)
	fun `a short list keeps the card sized to its content and centred`() {
		render(listOf(SharedArticlesDrop.Always("All"), SharedArticlesDrop.Unticked(readlist("Readlist 2"))), fontScale = 1f)

		val titleTop = compose.onNode(hasText(TITLE), useUnmergedTree = true).getUnclippedBoundsInRoot().top
		val windowHeight = compose.onRoot().getUnclippedBoundsInRoot().height
		val doneTouchBottom = with(compose.density) { done().fetchSemanticsNode().touchBoundsInRoot.bottom.toDp() }
		val spaceBelow = windowHeight - doneTouchBottom
		assertEquals("space above $titleTop, below $spaceBelow", titleTop.value, spaceBelow.value, 0.5f)
	}

	private fun render(drops: List<SharedArticlesDrop>, fontScale: Float) {
		val sheet = ShareSheetState().apply { chooserDrops = drops }
		compose.setContent {
			DeviceConfigurationOverride(DeviceConfigurationOverride.FontScale(fontScale)) {
				ReadplaceTheme { ShareSheet(sheet = sheet, onDismiss = {}, onEnded = {}) }
			}
		}
	}

	private fun done(): SemanticsNodeInteraction = compose.onNode(hasText("Done") and hasClickAction())

	private fun rowHeights(): Map<String, Dp> {
		val rows = compose.onAllNodes(isSelectable())
		return rows.fetchSemanticsNodes().indices.associate { index ->
			val row = rows[index]
			val label = row.fetchSemanticsNode().config.getOrNull(SemanticsProperties.Text)
				.orEmpty()
				.joinToString(" ") { it.text }
			label to row.getUnclippedBoundsInRoot().height
		}
	}

	private fun assertTouchHeightIsAtLeastTarget(node: SemanticsNodeInteraction) {
		val touchHeight = with(compose.density) { node.fetchSemanticsNode().touchBoundsInRoot.height.toDp() }
		assertTrue("touch target $touchHeight is under $TOUCH_TARGET", touchHeight >= TOUCH_TARGET)
	}

	private fun assertDoneUnsqueezedAndOnScreen() {
		done().assertIsDisplayed().assertHeightIsAtLeast(BUTTON_HEIGHT)
		val windowHeight = compose.onRoot().getUnclippedBoundsInRoot().height
		val doneBottom = done().getUnclippedBoundsInRoot().bottom
		assertTrue("Done ends at $doneBottom, below the window's $windowHeight", doneBottom <= windowHeight)
	}

	private fun assertListScrolls() {
		val range = compose.onNode(hasScrollAction(), useUnmergedTree = true)
			.fetchSemanticsNode().config[SemanticsProperties.VerticalScrollAxisRange]
		assertTrue("the list's scroll range ${range.maxValue()} should be above zero", range.maxValue() > 0f)
	}

	private fun overflows(text: SemanticsNodeInteraction): Boolean {
		val layouts = mutableListOf<TextLayoutResult>()
		text.fetchSemanticsNode().config[SemanticsActions.GetTextLayoutResult].action!!.invoke(layouts)
		val layout = layouts.single()
		return layout.didOverflowHeight ||
			(0 until layout.lineCount).any { line ->
				layout.isLineEllipsized(line) || layout.getLineRight(line) > layout.size.width
			}
	}

	private fun fullList(): List<SharedArticlesDrop> =
		listOf(SharedArticlesDrop.Always("All"), SharedArticlesDrop.Unticked(readlist(LONG_LABEL))) +
			(2..7).map { SharedArticlesDrop.Unticked(readlist("Readlist $it")) }

	private fun readlist(label: String) = Readlist(label = label, href = "/queue?queue=$label", isCurrent = false)

	private companion object {
		const val PORTRAIT = "w320dp-h568dp-xhdpi"
		const val LANDSCAPE = "w640dp-h360dp-land-xhdpi"
		const val TITLE = "Where do shared articles drop?"
		const val CAPTION = "Tick none and I'll drop them in your main readlist."
		val LONG_LABEL = "Longreads For The Weekend".take(24)
		val FULL_LIST_LABELS = listOf("All", LONG_LABEL) + (2..7).map { "Readlist $it" }
		val TOUCH_TARGET = 48.dp
		val BUTTON_HEIGHT = 40.dp
	}
}
