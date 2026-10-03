package dev.nitinranganath.watchsync

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.net.Uri
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.ui.platform.ClipEntry
import androidx.compose.ui.platform.LocalClipboard
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.health.connect.client.HealthConnectClient
import androidx.health.connect.client.PermissionController
import androidx.health.connect.client.contracts.ExerciseRouteRequestContract
import androidx.work.WorkInfo
import androidx.work.WorkManager
import kotlinx.coroutines.launch

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent {
            MaterialTheme(colorScheme = if (isSystemInDarkTheme()) darkColorScheme() else lightColorScheme()) {
                Scaffold { padding ->
                    Column(Modifier.padding(padding).padding(20.dp).fillMaxSize().verticalScroll(rememberScrollState())) {
                        when (HealthConnectClient.getSdkStatus(this@MainActivity)) {
                            HealthConnectClient.SDK_AVAILABLE -> SyncScreen()
                            HealthConnectClient.SDK_UNAVAILABLE_PROVIDER_UPDATE_REQUIRED -> HealthConnectMissing(update = true)
                            else -> HealthConnectMissing(update = false)
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun SyncScreen() {
    val context = LocalContext.current
    val settings = remember { Settings(context) }
    val reader = remember { HealthReader(HealthConnectClient.getOrCreate(context)) }
    val scope = rememberCoroutineScope()

    var url by remember { mutableStateOf(settings.serverUrl) }
    var token by remember { mutableStateOf(settings.token) }
    var autoSync by remember { mutableStateOf(settings.autoSync) }
    var status by remember { mutableStateOf(settings.lastResult) }
    var grantedCount by remember { mutableStateOf(0) }
    val wanted = remember { reader.permissionsToRequest() }

    suspend fun refreshGranted() { grantedCount = reader.grantedPermissions().intersect(wanted).size }
    LaunchedEffect(Unit) { refreshGranted() }

    val permissionLauncher = rememberLauncherForActivityResult(
        PermissionController.createRequestPermissionResultContract(),
    ) { scope.launch { refreshGranted() } }

    // The sync itself runs in WorkManager so it survives leaving this screen; we just watch it.
    val work by remember { WorkManager.getInstance(context).getWorkInfosForUniqueWorkFlow(SyncWorker.NOW) }
        .collectAsState(initial = emptyList())
    val info = work.firstOrNull()
    val busy = info?.state == WorkInfo.State.RUNNING || info?.state == WorkInfo.State.ENQUEUED
    val liveStatus = when {
        info?.state == WorkInfo.State.RUNNING -> info.progress.getString(SyncWorker.KEY_STATUS) ?: "Starting…"
        info?.state == WorkInfo.State.ENQUEUED && info.runAttemptCount > 0 -> settings.lastResult
        info?.state == WorkInfo.State.ENQUEUED -> "Waiting for Wi-Fi…"
        else -> null
    }
    LaunchedEffect(info?.state) {
        if (info?.state?.isFinished == true) status = settings.lastResult
    }

    fun startSync() = SyncWorker.runNow(context)

    val localNetworkLauncher = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        if (granted) startSync()
        else status = "Sync needs the \"local network\" permission to reach your computer. " +
            "Allow it in Settings → Apps → Watch Sync → Permissions."
    }

    Column(verticalArrangement = Arrangement.spacedBy(14.dp)) {
        Text("Watch Sync", style = MaterialTheme.typography.headlineSmall)
        Text(
            "Sends your Samsung Health data (via Health Connect) to the dashboard on your computer. " +
                "In Samsung Health, make sure Settings → Health Connect sync is turned on.",
            style = MaterialTheme.typography.bodyMedium,
        )

        Text("1. Dashboard connection", style = MaterialTheme.typography.titleMedium)
        OutlinedTextField(
            value = url, onValueChange = { url = it }, modifier = Modifier.fillMaxWidth(), singleLine = true,
            label = { Text("Server URL") }, placeholder = { Text("http://192.168.1.19:3000") },
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri),
        )
        OutlinedTextField(
            value = token, onValueChange = { token = it }, modifier = Modifier.fillMaxWidth(), singleLine = true,
            label = { Text("Token (INGEST_TOKEN)") }, visualTransformation = PasswordVisualTransformation(),
        )
        OutlinedButton(onClick = {
            settings.serverUrl = url
            settings.token = token
            url = settings.serverUrl
            status = "Saved."
        }) { Text("Save") }

        Text("2. Health Connect access", style = MaterialTheme.typography.titleMedium)
        Text("$grantedCount of ${wanted.size} data types allowed", style = MaterialTheme.typography.bodyMedium)
        OutlinedButton(onClick = { permissionLauncher.launch(wanted) }) { Text("Grant access") }

        Text("3. Sync", style = MaterialTheme.typography.titleMedium)
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Button(enabled = !busy, onClick = {
                settings.serverUrl = url
                settings.token = token
                if (needsLocalNetworkPermission(context)) localNetworkLauncher.launch(Manifest.permission.ACCESS_LOCAL_NETWORK)
                else startSync()
            }) { Text(if (busy) "Syncing…" else "Sync now") }
            // Reads the last 30 days again, e.g. to fill in details added in a newer app version.
            // Uploads are upserts, so nothing is duplicated.
            OutlinedButton(enabled = !busy, onClick = {
                settings.serverUrl = url
                settings.token = token
                settings.lastSyncMs = 0
                if (needsLocalNetworkPermission(context)) localNetworkLauncher.launch(Manifest.permission.ACCESS_LOCAL_NETWORK)
                else startSync()
            }) { Text("Re-sync last 30 days") }
        }

        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Switch(checked = autoSync, onCheckedChange = {
                autoSync = it
                settings.autoSync = it
                if (it) SyncWorker.schedule(context) else SyncWorker.cancel(context)
            })
            Text("Sync automatically every hour on Wi-Fi")
        }

        (liveStatus ?: status).takeIf { it.isNotBlank() }?.let { Text(it, style = MaterialTheme.typography.bodySmall) }

        RunCheckSection(reader.client)
    }
}

/**
 * Shows what Health Connect holds for the latest run (route, laps, how finely distance and speed
 * were recorded), so we know what per-km splits and maps could be built from. Reads only.
 */
@Composable
private fun RunCheckSection(client: HealthConnectClient) {
    val scope = rememberCoroutineScope()
    val clipboard = LocalClipboard.current
    var result by remember { mutableStateOf<RunCheck.Result?>(null) }
    var routeLine by remember { mutableStateOf<String?>(null) }
    var checking by remember { mutableStateOf(false) }

    // Samsung's routes belong to Samsung Health, so Health Connect asks you per run before sharing one
    val routeLauncher = rememberLauncherForActivityResult(ExerciseRouteRequestContract()) { route ->
        routeLine = "GPS route after allowing: " + if (route == null) "not shared, or none recorded" else RunCheck.describeRoute(route)
    }

    Text("4. Check run detail", style = MaterialTheme.typography.titleMedium)
    Text(
        "Looks at your latest run to see what Health Connect has for splits and maps. Nothing is uploaded.",
        style = MaterialTheme.typography.bodyMedium,
    )
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        OutlinedButton(enabled = !checking, onClick = {
            checking = true
            routeLine = null
            scope.launch {
                result = try {
                    RunCheck.latestRun(client)
                } catch (e: Exception) {
                    RunCheck.Result("Check failed: ${e.message}", null, false)
                }
                checking = false
            }
        }) { Text(if (checking) "Checking…" else "Check latest run") }
        result?.let { r ->
            OutlinedButton(onClick = {
                val text = listOfNotNull(r.report, routeLine).joinToString("\n")
                scope.launch { clipboard.setClipEntry(ClipEntry(android.content.ClipData.newPlainText("Run check", text))) }
            }) { Text("Copy") }
        }
    }
    result?.let { r ->
        if (r.routeNeedsConsent && r.sessionId != null && routeLine == null) {
            Button(onClick = { routeLauncher.launch(r.sessionId) }) { Text("Allow reading this run's route") }
        }
        SelectionContainer {
            Text(listOfNotNull(r.report, routeLine).joinToString("\n"), style = MaterialTheme.typography.bodySmall, fontFamily = FontFamily.Monospace)
        }
    }
}

/** Android 17 (API 37) gates connections to LAN addresses behind a runtime permission. */
private fun needsLocalNetworkPermission(context: android.content.Context) =
    Build.VERSION.SDK_INT >= 37 &&
        ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_LOCAL_NETWORK) != PackageManager.PERMISSION_GRANTED

@Composable
private fun HealthConnectMissing(update: Boolean) {
    val context = LocalContext.current
    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text(
            if (update) "Health Connect needs an update." else "Health Connect isn't available on this phone.",
            style = MaterialTheme.typography.titleMedium,
        )
        if (update) {
            Button(onClick = {
                val uri = Uri.parse("market://details?id=com.google.android.apps.healthdata&url=healthconnect%3A%2F%2Fonboarding")
                context.startActivity(Intent(Intent.ACTION_VIEW, uri).setPackage("com.android.vending"))
            }) { Text("Open Play Store") }
        }
    }
}
