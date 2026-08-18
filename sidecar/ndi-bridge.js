/**
 * cam2pc NDI Bridge Sidecar
 *
 * Receives raw RGBA video frames from the Tauri app via stdin (binary IPC)
 * and outputs them as an NDI source named "Cam2PC" using the `grandiose` package.
 *
 * Prerequisites (user-installed, both free):
 *   1. NDI Tools Runtime — https://ndi.video/tools/
 *   2. DistroAV plugin for OBS — https://github.com/DistroAV/DistroAV
 *
 * Frame protocol (stdin):
 *   Each message: [4-byte LE uint32 frame_length][frame_length bytes RGBA data]
 *
 * Stdout: JSON status messages for Tauri to consume.
 */

'use strict';

const NDI_SOURCE_NAME = 'Cam2PC';
const NDI_WIDTH = 1920;
const NDI_HEIGHT = 1080;
const NDI_FPS_N = 30000;
const NDI_FPS_D = 1001; // ~29.97 fps
const EXPECTED_FRAME_SIZE = NDI_WIDTH * NDI_HEIGHT * 4; // RGBA

// ── Load grandiose ────────────────────────────────────────────────────────────

let grandiose;
try {
  grandiose = require('grandiose');
  log('info', 'grandiose loaded successfully');
} catch (e) {
  log('error', `grandiose not available: ${e.message}`);
  log('error', 'Install NDI Tools from https://ndi.video/tools/ then run: npm install grandiose');
  process.exit(1);
}

// ── NDI sender ────────────────────────────────────────────────────────────────

let ndiSender = null;

async function initSender() {
  ndiSender = await grandiose.send({
    name: NDI_SOURCE_NAME,
    groups: 'Cam2PC',
    clockVideo: true,
    clockAudio: false,
  });
  log('info', `NDI source "${NDI_SOURCE_NAME}" initialized`);
}

/** Rate-limit NDI output to avoid overloading the network. */
let lastFrameAt = 0;
const MIN_FRAME_INTERVAL_MS = 1000 / 32; // allow up to 32fps with some headroom

async function sendFrame(buffer) {
  if (!ndiSender) return;

  const now = Date.now();
  if (now - lastFrameAt < MIN_FRAME_INTERVAL_MS) return;
  lastFrameAt = now;

  try {
    await ndiSender.video({
      xres: NDI_WIDTH,
      yres: NDI_HEIGHT,
      frameRateN: NDI_FPS_N,
      frameRateD: NDI_FPS_D,
      pictureAspectRatio: NDI_WIDTH / NDI_HEIGHT,
      data: buffer,
    });
  } catch (e) {
    // Frame send failure is non-fatal (e.g. receiver disconnected)
  }
}

// ── stdin frame reader ────────────────────────────────────────────────────────

/**
 * Reads length-prefixed binary frames from stdin.
 * Each frame: [4-byte LE uint32 length][<length> bytes RGBA]
 */
function startStdinReader() {
  const chunks = [];
  let needed = 4; // Start by reading the 4-byte length prefix
  let readingHeader = true;
  let frameLength = 0;

  process.stdin.on('data', (chunk) => {
    chunks.push(chunk);
    const buffered = Buffer.concat(chunks);

    let offset = 0;
    while (offset + needed <= buffered.length) {
      if (readingHeader) {
        frameLength = buffered.readUInt32LE(offset);
        offset += 4;
        needed = frameLength;
        readingHeader = false;
      } else {
        const frameData = buffered.slice(offset, offset + frameLength);
        offset += frameLength;

        if (frameData.length === EXPECTED_FRAME_SIZE) {
          sendFrame(frameData).catch(() => {});
        } else {
          log('warn', `Unexpected frame size: ${frameData.length} (expected ${EXPECTED_FRAME_SIZE})`);
        }

        needed = 4;
        readingHeader = true;
      }
    }

    // Keep only unprocessed bytes
    chunks.length = 0;
    if (offset < buffered.length) {
      chunks.push(buffered.slice(offset));
    }
  });

  process.stdin.on('end', () => {
    log('info', 'stdin closed — shutting down NDI bridge');
    process.exit(0);
  });
}

// ── Utilities ─────────────────────────────────────────────────────────────────

function log(level, message) {
  process.stdout.write(JSON.stringify({ level, message, ts: Date.now() }) + '\n');
}

// ── Entry point ───────────────────────────────────────────────────────────────

(async () => {
  try {
    await initSender();
    startStdinReader();
    log('info', 'NDI bridge ready — waiting for frames');
  } catch (e) {
    log('error', `Failed to initialize: ${e.message}`);
    process.exit(1);
  }
})();
