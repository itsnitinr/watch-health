package dev.nitinranganath.watchsync

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL

/** Posts ingest payloads to the dashboard's /api/ingest endpoint. */
class Uploader(private val serverUrl: String, private val token: String) {

    suspend fun send(payload: JSONObject): JSONObject = withContext(Dispatchers.IO) {
        val conn = URL("$serverUrl/api/ingest").openConnection() as HttpURLConnection
        try {
            conn.requestMethod = "POST"
            conn.connectTimeout = 15_000
            conn.readTimeout = 60_000
            conn.doOutput = true
            conn.setRequestProperty("Content-Type", "application/json")
            conn.setRequestProperty("Authorization", "Bearer $token")
            conn.outputStream.use { it.write(payload.toString().toByteArray()) }

            val code = conn.responseCode
            val body = (if (code in 200..299) conn.inputStream else conn.errorStream)
                ?.bufferedReader()?.use { it.readText() } ?: ""
            when {
                code == 401 -> throw AuthException("Server rejected the token (401). Check the token matches INGEST_TOKEN.")
                code !in 200..299 -> throw IOException("Server returned $code: ${body.take(200)}")
            }
            JSONObject(body)
        } finally {
            conn.disconnect()
        }
    }

    /** Not worth retrying: the user has to fix the configuration. */
    class AuthException(message: String) : Exception(message)
}
