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
