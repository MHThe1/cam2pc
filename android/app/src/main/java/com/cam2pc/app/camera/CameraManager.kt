package com.cam2pc.app.camera

import android.content.Context
import android.util.Log
import android.util.Size
import androidx.camera.core.CameraSelector
import androidx.camera.core.Preview
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.core.content.ContextCompat
import androidx.lifecycle.LifecycleOwner
import java.util.concurrent.Executors

/**
 * CameraManager using CameraX to pipe frames directly into the VideoEncoder's hardware input Surface.
 */
class CameraManager(
    private val context: Context,
    private val lifecycleOwner: LifecycleOwner,
    private val width: Int,
    private val height: Int,
    private var isFrontFacing: Boolean = false
) {
    companion object {
        private const val TAG = "CameraManager"
    }

    private var cameraProvider: ProcessCameraProvider? = null
    private val cameraExecutor = Executors.newSingleThreadExecutor()

    fun start(encoder: VideoEncoder, onStarted: () -> Unit = {}) {
        val cameraProviderFuture = ProcessCameraProvider.getInstance(context)
        cameraProviderFuture.addListener({
            try {
                cameraProvider = cameraProviderFuture.get()
                bindCamera(encoder)
                onStarted()
            } catch (e: Exception) {
                Log.e(TAG, "Failed to start camera: ${e.message}", e)
            }
        }, ContextCompat.getMainExecutor(context))
    }

    private fun bindCamera(encoder: VideoEncoder) {
        val provider = cameraProvider ?: return
        provider.unbindAll()

        val cameraSelector = if (isFrontFacing) {
            CameraSelector.DEFAULT_FRONT_CAMERA
        } else {
            CameraSelector.DEFAULT_BACK_CAMERA
        }

        val surface = encoder.inputSurface ?: return

        val preview = Preview.Builder()
            .setTargetResolution(Size(width, height))
            .build()

        preview.setSurfaceProvider(cameraExecutor) { request ->
            request.provideSurface(surface, cameraExecutor) {
                Log.d(TAG, "Surface result: ${it.resultCode}")
            }
        }

        try {
            provider.bindToLifecycle(lifecycleOwner, cameraSelector, preview)
            Log.i(TAG, "Camera bound to hardware encoder surface: ${width}x${height}")
        } catch (e: Exception) {
            Log.e(TAG, "Use case binding failed: ${e.message}", e)
        }
    }

    fun flipCamera(encoder: VideoEncoder) {
        isFrontFacing = !isFrontFacing
        bindCamera(encoder)
    }

    fun stop() {
        cameraProvider?.unbindAll()
        cameraExecutor.shutdown()
    }
}
