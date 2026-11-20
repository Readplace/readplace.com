package com.readplace.android.app

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp

@Composable
fun AgeRefusedScreen(text: String) {
	Surface(modifier = Modifier.fillMaxSize()) {
		Box(modifier = Modifier.fillMaxSize().padding(40.dp), contentAlignment = Alignment.Center) {
			Text(
				text = text,
				style = MaterialTheme.typography.titleMedium,
				textAlign = TextAlign.Center,
			)
		}
	}
}

@Composable
fun AgeVerificationPrompt(onOpenPlay: () -> Unit, onDismiss: () -> Unit, modifier: Modifier = Modifier) {
	Surface(
		modifier = modifier.fillMaxWidth().padding(16.dp),
		shape = MaterialTheme.shapes.large,
		tonalElevation = 6.dp,
		shadowElevation = 6.dp,
	) {
		Column(modifier = Modifier.padding(20.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
			Text(text = "Google Play needs to confirm your age", style = MaterialTheme.typography.titleMedium)
			Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
				TextButton(onClick = onDismiss, colors = brandTextButtonColors()) {
					Text(text = stringResource(android.R.string.cancel))
				}
				TextButton(onClick = onOpenPlay, colors = brandTextButtonColors()) {
					Text(text = "Open Google Play")
				}
			}
		}
	}
}
