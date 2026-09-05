package com.cam2pc.app.camera

import android.media.MediaCodec
import android.media.MediaCodecInfo
import android.media.MediaFormat
import android.util.Log
import android.view.Surface
import java.nio.ByteBuffer

/**
 * High-performance hardware H.264 video encoder using Android's native MediaCodec.
 *
 * Utilizes a direct hardware input Surface so frames flow straight from camera
 * sensor hardware into the SoC hardware encoder ASIC with zero CPU copies.
 */
class VideoEncoder(
    private val width: Int,
    private val height: Int,
    private val frameRate: Int,
    private val bitrateBps: Int,
    private val onFrameEncoded: (ByteArray, Boolean) -> Unit
) {
    companion object {
        private const val TAG = "VideoEncoder"
        private const val MIME_TYPE = MediaFormat.MIMETYPE_VIDEO_AVC // H.264
        private const val I_FRAME_INTERVAL = 1 // 1 second between keyframes for low latency
    }

    private var codec: MediaCodec? = null
    var inputSurface: Surface? = null
        private set

    @Volatile
    private var isRunning = false
    private var outputThread: Thread? = null

    fun start() {
        val format = MediaFormat.createVideoFormat(MIME_TYPE, width, height).apply {
            setInteger(MediaFormat.KEY_COLOR_FORMAT, MediaCodecInfo.CodecCapabilities.COLOR_FormatSurface)
            setInteger(MediaFormat.KEY_BIT_RATE, bitrateBps)
            setInteger(MediaFormat.KEY_FRAME_RATE, frameRate)
            setInteger(MediaFormat.KEY_I_FRAME_INTERVAL, I_FRAME_INTERVAL)

            // Low-latency encoder profile
            try {
                setInteger(MediaFormat.KEY_PROFILE, MediaCodecInfo.CodecProfileLevel.AVCProfileBaseline)
                setInteger(MediaFormat.KEY_LEVEL, MediaCodecInfo.CodecProfileLevel.AVCLevel31)
            } catch (ignored: Exception) {}

            try {
                // Real-time priority
                setInteger(MediaFormat.KEY_PRIORITY, 0)
                setInteger(MediaFormat.KEY_COMPLEXITY, 0)
            } catch (ignored: Exception) {}
        }

        val encoder = MediaCodec.createEncoderByType(MIME_TYPE)
        encoder.configure(format, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE)
        inputSurface = encoder.createInputSurface()
        encoder.start()

        codec = encoder
        isRunning = true

        outputThread = Thread({ drainEncoder() }, "MediaCodec-Drainer").apply {
            priority = Thread.MAX_PRIORITY
            start()
        }
        Log.i(TAG, "Hardware H.264 encoder started: ${width}x${height} @ ${frameRate}fps, ${bitrateBps / 1_000_000} Mbps")
    }

    private fun drainEncoder() {
        val encoder = codec ?: return
        val bufferInfo = MediaCodec.BufferInfo()
        val configBytes = ArrayList<Byte>()

        while (isRunning) {
            try {
                val outputIndex = encoder.dequeueOutputBuffer(bufferInfo, 10_000)
                if (outputIndex >= 0) {
                    val outputBuffer: ByteBuffer? = encoder.getOutputBuffer(outputIndex)
                    if (outputBuffer != null && bufferInfo.size > 0) {
                        outputBuffer.position(bufferInfo.offset)
                        outputBuffer.limit(bufferInfo.offset + bufferInfo.size)

                        val outData = ByteArray(bufferInfo.size)
                        outputBuffer.get(outData)

                        val isConfig = (bufferInfo.flags and MediaCodec.BUFFER_FLAG_CODEC_CONFIG) != 0
                        val isKeyframe = (bufferInfo.flags and MediaCodec.BUFFER_FLAG_KEY_FRAME) != 0

                        if (isConfig) {
                            configBytes.clear()
                            outData.forEach { configBytes.add(it) }
                        } else {
                            if (isKeyframe && configBytes.isNotEmpty()) {
                                // Prepend SPS/PPS headers to keyframe so receiver decodes immediately
                                val fullPacket = ByteArray(configBytes.size + outData.size)
                                for (i in configBytes.indices) fullPacket[i] = configBytes[i]
                                System.arraycopy(outData, 0, fullPacket, configBytes.size, outData.size)
                                onFrameEncoded(fullPacket, true)
                            } else {
                                onFrameEncoded(outData, isKeyframe)
                            }
                        }
                    }
                    encoder.releaseOutputBuffer(outputIndex, false)
                }
            } catch (e: Exception) {
                if (!isRunning) break
                Log.w(TAG, "Exception draining encoder: ${e.message}")
            }
        }
    }

    fun stop() {
        isRunning = false
        outputThread?.interrupt()
        outputThread = null

        try {
            codec?.stop()
            codec?.release()
        } catch (ignored: Exception) {}
        codec = null

        inputSurface?.release()
        inputSurface = null
        Log.i(TAG, "Hardware H.264 encoder stopped")
    }
}
