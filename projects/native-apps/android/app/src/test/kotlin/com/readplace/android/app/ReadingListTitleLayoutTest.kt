package com.readplace.android.app

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.IconButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.test.DeviceConfigurationOverride
import androidx.compose.ui.test.ExperimentalTestApi
import androidx.compose.ui.test.FontScale
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.text.TextLayoutResult
import androidx.compose.ui.unit.dp
import com.readplace.android.testing.ComposeHostActivityRule
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

@OptIn(ExperimentalTestApi::class, ExperimentalMaterial3Api::class)
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class ReadingListTitleLayoutTest {
	@get:Rule(order = 0)
	val host = ComposeHostActivityRule()

	@get:Rule(order = 1)
	val compose = createComposeRule()

	@Test
	@Config(qualifiers = "w360dp-h640dp-xxhdpi")
	fun `the title and readlist name keep one line beside every toolbar control at a larger font`() {
		compose.setContent {
			DeviceConfigurationOverride(DeviceConfigurationOverride.FontScale(1.3f)) {
				ReadplaceTheme {
					TopAppBar(
						title = { ReadingListTitle(currentReadlistLabel = "All") },
						navigationIcon = { TextButton(onClick = {}) { Text(text = "Sign out") } },
						actions = {
							IconButton(onClick = {}) { Box(modifier = Modifier.size(24.dp)) }
							IconButton(onClick = {}) { Box(modifier = Modifier.size(24.dp)) }
							TextButton(onClick = {}) { Text(text = "Account") }
							IconButton(onClick = {}) { Box(modifier = Modifier.size(24.dp)) }
						},
					)
				}
			}
		}

		assertEquals(mapOf("Reading List" to 1, "All" to 1), listOf("Reading List", "All").associateWith(::lineCount))
	}

	private fun lineCount(text: String): Int {
		val node = compose.onNode(hasText(text), useUnmergedTree = true).fetchSemanticsNode()
		val layouts = mutableListOf<TextLayoutResult>()
		checkNotNull(node.config[SemanticsActions.GetTextLayoutResult].action)(layouts)
		return layouts.single().lineCount
	}
}
