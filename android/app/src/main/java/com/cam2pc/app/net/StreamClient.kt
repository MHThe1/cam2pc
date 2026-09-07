package com.cam2pc.app.net

import android.util.Log
import okhttp3.*
import okio.ByteString.Companion.toByteString
import java.security.SecureRandom
import java.security.cert.X509Certificate
import java.util.concurrent.TimeUnit
import javax.net.ssl.SSLContext
import javax.net.ssl.TrustManager
import javax.net.ssl.X509TrustManager

/**
 * High-performance WebSocket stream client using OkHttp.
 * Streams binary H.264 NAL units directly to the PC Cam2PC signaling server.
 */
class StreamClient(
    private val serverUrl: String,
    private val roomId: String,
    private val onStateChange: (Boolean, String) -> Unit
) {
    companion object {
        private const val TAG = "StreamClient"
    }

    private val client = createOkHttpClient()

    private fun createOkHttpClient(): OkHttpClient {
        return try {
            val trustAllCerts = arrayOf<TrustManager>(object : X509TrustManager {
                override fun checkClientTrusted(chain: Array<out X509Certificate>?, authType: String?) {}
                override fun checkServerTrusted(chain: Array<out X509Certificate>?, authType: String?) {}
                override fun getAcceptedIssuers(): Array<X509Certificate> = arrayOf()
            })

            val sslContext = SSLContext.getInstance("SSL")
            sslContext.init(null, trustAllCerts, SecureRandom())

            OkHttpClient.Builder()
                .sslSocketFactory(sslContext.socketFactory, trustAllCerts[0] as X509TrustManager)
                .hostnameVerifier { _, _ -> true }
                .connectTimeout(6, TimeUnit.SECONDS)
                .readTimeout(0, TimeUnit.MILLISECONDS) // Keep-alive indefinitely
                .build()
        } catch (e: Exception) {
            OkHttpClient.Builder()
                .connectTimeout(6, TimeUnit.SECONDS)
                .readTimeout(0, TimeUnit.MILLISECONDS)
                .build()
        }
    }

    private var webSocket: WebSocket? = null
    @Volatile
    var isConnected: Boolean = false
        private set

    fun connect() {
        val request = Request.Builder().url(serverUrl).build()
        webSocket = client.newWebSocket(request, object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) {
                isConnected = true
                Log.i(TAG, "Connected to PC server: $serverUrl")
                // Join room
                val joinMsg = """{"type":"join","room":"$roomId","role":"native-sender"}"""
                webSocket.send(joinMsg)
                onStateChange(true, "Connected to PC")
            }

            override fun onMessage(webSocket: WebSocket, text: String) {
                Log.d(TAG, "Server msg: $text")
            }

            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                isConnected = false
                Log.e(TAG, "WebSocket failure: ${t.message}")
                onStateChange(false, "Connection error: ${t.message}")
            }

            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                isConnected = false
                Log.i(TAG, "WebSocket closed: $reason ($code)")
                onStateChange(false, "Disconnected")
            }
        })
    }

    fun sendFrame(frameData: ByteArray, isKeyframe: Boolean) {
        if (!isConnected) return
        val ws = webSocket ?: return

        // Prefix 1 byte: 0x01 for Keyframe, 0x00 for Delta frame
        val packet = ByteArray(frameData.size + 1)
        packet[0] = if (isKeyframe) 1 else 0
        System.arraycopy(frameData, 0, packet, 1, frameData.size)

        ws.send(packet.toByteString())
    }

    fun disconnect() {
        isConnected = false
        try {
            webSocket?.close(1000, "User stopped stream")
        } catch (ignored: Exception) {}
        webSocket = null
        client.dispatcher.executorService.shutdown()
    }
}
