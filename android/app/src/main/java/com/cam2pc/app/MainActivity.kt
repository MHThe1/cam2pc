package com.cam2pc.app

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.view.View
import android.widget.Toast
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import com.cam2pc.app.camera.CameraManager
import com.cam2pc.app.camera.VideoEncoder
import com.cam2pc.app.databinding.ActivityMainBinding
import com.cam2pc.app.net.StreamClient
import com.cam2pc.app.service.StreamService
import com.journeyapps.barcodescanner.ScanContract
import com.journeyapps.barcodescanner.ScanOptions

class MainActivity : AppCompatActivity() {

    private lateinit var binding: ActivityMainBinding

    private var encoder: VideoEncoder? = null
    private var cameraManager: CameraManager? = null
    private var streamClient: StreamClient? = null

    private var isStreaming = false

    // QR scanner launcher
    private val qrScannerLauncher = registerForActivityResult(ScanContract()) { result ->
        if (result.contents != null) {
            parseQrUrl(result.contents)
        }
    }

    // Permission launcher
    private val permissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions()
    ) { permissions ->
        val cameraGranted = permissions[Manifest.permission.CAMERA] ?: false
        if (!cameraGranted) {
            Toast.makeText(this, "Camera permission required for streaming", Toast.LENGTH_LONG).show()
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityMainBinding.inflate(layoutInflater)
        setContentView(binding.root)

        checkPermissions()
        setupListeners()
    }

    private fun checkPermissions() {
        val required = mutableListOf(Manifest.permission.CAMERA, Manifest.permission.RECORD_AUDIO)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            required.add(Manifest.permission.POST_NOTIFICATIONS)
        }

        val needed = required.filter {
            ContextCompat.checkSelfPermission(this, it) != PackageManager.PERMISSION_GRANTED
        }
        if (needed.isNotEmpty()) {
            permissionLauncher.launch(needed.toTypedArray())
        }
    }

    private fun setupListeners() {
        // QR Scanner
        binding.btnScanQr.setOnClickListener {
            val options = ScanOptions().apply {
                setPrompt("Point camera at PC screen QR code")
                setBeepEnabled(true)
                setOrientationLocked(false)
            }
            qrScannerLauncher.launch(options)
        }

        // Start / Stop Stream
        binding.btnStreamToggle.setOnClickListener {
            if (isStreaming) {
                stopStreaming()
            } else {
                startStreaming()
            }
        }

        // Flip camera
        binding.btnFlip.setOnClickListener {
            val enc = encoder
            if (enc != null) {
                cameraManager?.flipCamera(enc)
            }
        }

        // Performance / Dim screen
        binding.btnDim.setOnClickListener {
            binding.dimOverlay.visibility = View.VISIBLE
        }

        binding.dimOverlay.setOnClickListener {
            binding.dimOverlay.visibility = View.GONE
        }
    }

    private fun parseQrUrl(url: String) {
        try {
            val uri = Uri.parse(url)
            val host = uri.host ?: return
            val port = uri.port
            val room = uri.getQueryParameter("room") ?: ""

            // PC exposes port 3001 for high-performance plain WebSocket streaming.
            // Port 3000 is HTTPS for web browsers.
            val serverUrl = if (port == 3000 || port <= 0) "$host:3001" else "$host:$port"
            binding.editServerUrl.setText(serverUrl)
            binding.editRoomId.setText(room)

            Toast.makeText(this, "PC found: Room $room", Toast.LENGTH_SHORT).show()
        } catch (e: Exception) {
            Toast.makeText(this, "Invalid QR Code", Toast.LENGTH_SHORT).show()
        }
    }

    private fun startStreaming() {
        var serverAddr = binding.editServerUrl.text?.toString()?.trim() ?: ""
        val roomId = binding.editRoomId.text?.toString()?.trim() ?: ""

        if (serverAddr.isEmpty() || roomId.isEmpty()) {
            Toast.makeText(this, "Please enter PC address & Room ID (or Scan QR)", Toast.LENGTH_LONG).show()
            return
        }

        // Clean protocol prefix if typed
        serverAddr = serverAddr.removePrefix("http://").removePrefix("https://")
            .removePrefix("ws://").removePrefix("wss://").trimEnd('/')

        // Resolve profile
        val (width, height, fps, bitrate) = when (binding.radioProfiles.checkedRadioButtonId) {
            binding.rbSmooth.id -> Quad(1280, 720, 30, 3_000_000)
            binding.rbPro.id -> Quad(1920, 1080, 60, 12_000_000)
            else -> Quad(1920, 1080, 30, 6_000_000) // Balanced default
        }

        // Build WebSocket URL: port 3000 uses wss://, 3001 (or default) uses ws://
        val wsUrl = when {
            serverAddr.endsWith(":3000") -> "wss://$serverAddr/ws"
            serverAddr.contains(":") -> "ws://$serverAddr/ws"
            else -> "ws://$serverAddr:3001/ws"
        }

        streamClient = StreamClient(wsUrl, roomId) { connected, msg ->
            runOnUiThread {
                binding.txtStatus.text = msg
                binding.txtStatus.setTextColor(
                    if (connected) getColor(R.color.live_red) else getColor(R.color.accent)
                )
            }
        }.apply { connect() }

        // Start hardware encoder
        encoder = VideoEncoder(width, height, fps, bitrate) { frameData, isKeyframe ->
            streamClient?.sendFrame(frameData, isKeyframe)
        }.also { it.start() }

        // Start camera
        val enc = encoder ?: return
        cameraManager = CameraManager(this, this, width, height).also {
            it.start(enc)
        }

        // Start foreground service to keep running with screen off
        val serviceIntent = Intent(this, StreamService::class.java).apply {
            action = StreamService.ACTION_START
        }
        startService(serviceIntent)

        isStreaming = true
        binding.btnStreamToggle.text = "Stop Stream"
        binding.btnStreamToggle.backgroundTintList = getColorStateList(R.color.live_red)
        binding.setupCard.visibility = View.GONE
    }

    private fun stopStreaming() {
        val serviceIntent = Intent(this, StreamService::class.java).apply {
            action = StreamService.ACTION_STOP
        }
        startService(serviceIntent)

        cameraManager?.stop()
        cameraManager = null

        encoder?.stop()
        encoder = null

        streamClient?.disconnect()
        streamClient = null

        isStreaming = false
        binding.btnStreamToggle.text = "Start Stream"
        binding.btnStreamToggle.backgroundTintList = getColorStateList(R.color.accent)
        binding.setupCard.visibility = View.VISIBLE
        binding.txtStatus.text = "Ready"
        binding.txtStatus.setTextColor(getColor(R.color.accent))
    }

    override fun onDestroy() {
        if (isStreaming) {
            stopStreaming()
        }
        super.onDestroy()
    }

    private data class Quad(val w: Int, val h: Int, val fps: Int, val bitrate: Int)
}
