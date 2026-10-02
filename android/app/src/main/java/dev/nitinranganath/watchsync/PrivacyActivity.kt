package dev.nitinranganath.watchsync

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp

/** Shown by Health Connect when the user asks how this app uses their data. */
class PrivacyActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            MaterialTheme {
                Column(Modifier.padding(24.dp)) {
                    Text("How Watch Sync uses your data", style = MaterialTheme.typography.headlineSmall)
                    Text(
                        "Watch Sync reads the health data you allow from Health Connect and sends it only to " +
                            "the server address you entered — your own dashboard on your own computer. " +
                            "It does not send data anywhere else and has no analytics.",
                        Modifier.padding(top = 12.dp),
                    )
                }
            }
        }
    }
}
