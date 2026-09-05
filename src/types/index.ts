// ── Signaling message types ───────────────────────────────────────────────────

export type SignalingRole = 'viewer' | 'sender';

export interface RoomCreatedMsg {
  type: 'room-created';
  roomId: string;
  senderUrl: string;
  qrDataUrl: string;
  ndiAvailable: boolean;
}

export interface SenderJoinedMsg {
  type: 'sender-joined';
}

export interface SenderLeftMsg {
  type: 'sender-left';
}

export interface CreateOfferMsg {
  type: 'create-offer';
}

export interface OfferMsg {
  type: 'offer';
  sdp: RTCSessionDescriptionInit;
}

export interface AnswerMsg {
  type: 'answer';
  sdp: RTCSessionDescriptionInit;
}

export interface IceCandidateMsg {
  type: 'ice-candidate';
  candidate: RTCIceCandidateInit;
}

export type SignalingMessage =
  | RoomCreatedMsg
  | SenderJoinedMsg
  | SenderLeftMsg
  | CreateOfferMsg
  | OfferMsg
  | AnswerMsg
  | IceCandidateMsg;

// ── WebRTC stats ──────────────────────────────────────────────────────────────

export interface StreamStats {
  resolution: string;
  fps: number;
  bitrateBps: number;
  latencyMs: number | null;
}

// ── Connection state ──────────────────────────────────────────────────────────

export type ConnectionStatus =
  | 'idle'
  | 'waiting'
  | 'connecting'
  | 'connected'
  | 'disconnected'
  | 'error';

// ── Recording ─────────────────────────────────────────────────────────────────

export type RecordingStatus = 'idle' | 'recording' | 'saving';

export interface RecordingState {
  status: RecordingStatus;
  durationSeconds: number;
  sizeBytes: number;
}

// ── Server info (from Rust backend) ──────────────────────────────────────────

export interface ServerInfo {
  ip: string;
  port: number;
  url: string;
  localWsUrl?: string;
}

// ── Quality Presets ──────────────────────────────────────────────────────────

export type QualityPresetKey = 'smooth' | 'balanced' | 'pro';

export interface QualityPresetConfig {
  key: QualityPresetKey;
  label: string;
  shortLabel: string;
  desc: string;
  width: number;
  height: number;
  fps: number;
  bitrateBps: number;
}

export const QUALITY_PRESETS: Record<QualityPresetKey, QualityPresetConfig> = {
  smooth: {
    key: 'smooth',
    label: 'Smooth (Older Phones)',
    shortLabel: '720p 30',
    desc: '720p · 30fps · 4 Mbps (Lag-free on older devices)',
    width: 1280,
    height: 720,
    fps: 30,
    bitrateBps: 4_000_000,
  },
  balanced: {
    key: 'balanced',
    label: 'Balanced (Standard)',
    shortLabel: '1080p 30',
    desc: '1080p · 30fps · 8 Mbps (Crisp streaming)',
    width: 1920,
    height: 1080,
    fps: 30,
    bitrateBps: 8_000_000,
  },
  pro: {
    key: 'pro',
    label: 'Pro (Modern Phones)',
    shortLabel: '1080p 60',
    desc: '1080p · 60fps · 20 Mbps (Smooth 60fps for fast Wi-Fi)',
    width: 1920,
    height: 1080,
    fps: 60,
    bitrateBps: 20_000_000,
  },
};
