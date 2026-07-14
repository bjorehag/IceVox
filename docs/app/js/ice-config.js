// Shared ICE server configuration for WebRTC connections.
// Used by both connection.js (audio mesh) and video-renderer.js (video connections).

const ICE_SERVERS = [
  // Multiple STUN servers — help discover public IP/port for direct P2P
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun2.l.google.com:19302' },
  { urls: 'stun:stun3.l.google.com:19302' },
  { urls: 'stun:stun4.l.google.com:19302' },
  // OpenRelay free public TURN servers — relay fallback for strict NAT/firewall
  // Without TURN, ~20-30% of users behind symmetric NAT cannot connect at all.
  // Credentials are the official public OpenRelay project credentials (openrelayproject).
  // WebRTC tries direct P2P first; only falls back to relay if direct fails.
  { urls: 'turn:openrelay.metered.ca:80',                 username: 'openrelayproject', credential: 'openrelayproject' },
  { urls: 'turn:openrelay.metered.ca:80?transport=tcp',   username: 'openrelayproject', credential: 'openrelayproject' },
  { urls: 'turn:openrelay.metered.ca:443?transport=tcp',  username: 'openrelayproject', credential: 'openrelayproject' },
  { urls: 'turns:openrelay.metered.ca:443?transport=tcp', username: 'openrelayproject', credential: 'openrelayproject' },
];
