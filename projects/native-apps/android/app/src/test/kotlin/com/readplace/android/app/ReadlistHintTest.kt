package com.readplace.android.app

import androidx.compose.foundation.layout.Column
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import com.readplace.android.testing.ComposeHostActivityRule
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

@RunWith(RobolectricTestRunner::class)
class ReadlistHintTest {
	@get:Rule(order = 0)
	val host = ComposeHostActivityRule()

	@get:Rule(order = 1)
	val compose = createComposeRule()

	private val hint = ReadlistHintContent(text = "Older saves stay elsewhere.", linkLabel = "Open it", url = "https://readplace.test/queue")

	private fun show(onOpen: (String) -> Unit) {
		compose.setContent {
			ReadplaceTheme {
				Column { ReadlistHint(hint = hint, onOpen = onOpen) }
			}
		}
	}

	@Test
	fun `shows the hint's text and its link`() {
		show(onOpen = {})

		compose.onNodeWithText("Older saves stay elsewhere.").assertIsDisplayed()
		compose.onNodeWithText("Open it").assertIsDisplayed()
	}

	@Test
	fun `opens the hint's link when it is tapped`() {
		val opened = mutableListOf<String>()
		show(onOpen = { opened += it })

		compose.onNodeWithText("Open it").performClick()

		assertEquals(listOf("https://readplace.test/queue"), opened)
	}
}
