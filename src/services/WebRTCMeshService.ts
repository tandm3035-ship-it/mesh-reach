// WebRTC Mesh Service
// Enables P2P connections over the internet via WebRTC data channels
// Works even when BLE/WiFi direct are not available

import { MeshDevice, ConnectionType } from '@/types/mesh';
import { multiTransportMesh, TransportType, PeerInfo } from './MultiTransportMesh';
import { MeshPacket, decodePacket, createPacket, MESH_NAME_PREFIX } from './MeshProtocol';
import Peer, { Instance as SimplePeerInstance, SignalData } from 'simple-peer';

// Free STUN servers for NAT traversal
const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun2.l.google.com:19302' },
  { urls: 'stun:stun3.l.google.com:19302' },
  { urls: 'stun:stun4.l.google.com:19302' },
  { urls: 'stun:global.stun.twilio.com:3478' },
  { urls: 'stun:stun.voip.blackberry.com:3478' },
];

interface PeerConnection {
  peer: SimplePeerInstance;
  peerId: string;
  isInitiator: boolean;
  connected: boolean;
  signalData?: SignalData;
}

/**
 * WebRTC Mesh Service
 * Creates a mesh network using WebRTC data channels
 * Devices exchange signals via multiple methods (BLE, WiFi, QR codes, manual entry)
 */
export class WebRTCMeshService {
  private localId: string = '';
  private connections: Map<string, PeerConnection> = new Map();
  private pendingSignals: Map<string, SignalData[]> = new Map();
  private discoveryChannel?: BroadcastChannel;
  private isInitialized: boolean = false;

  public async initialize(localDeviceId: string): Promise<boolean> {
    this.localId = localDeviceId;

    try {
      // Use BroadcastChannel for same-origin discovery (multiple tabs/windows)
      if (typeof BroadcastChannel !== 'undefined') {
        this.discoveryChannel = new BroadcastChannel('mesh_discovery');
        this.discoveryChannel.onmessage = (event) => {
          this.handleDiscoveryMessage(event.data);
        };

        // Announce presence periodically
        this.announceViaChannel();
        setInterval(() => this.announceViaChannel(), 10000);
      }

      this.isInitialized = true;
      multiTransportMesh.updateTransportStatus('webrtc', { available: true, enabled: true });
      return true;
    } catch (error) {
      console.error('WebRTC init error:', error);
      multiTransportMesh.updateTransportStatus('webrtc', { available: false, error: String(error) });
      return false;
    }
  }

  private announceViaChannel() {
    if (this.discoveryChannel) {
      this.discoveryChannel.postMessage({
        type: 'ANNOUNCE',
        from: this.localId,
        name: multiTransportMesh.getLocalDeviceName(),
        timestamp: Date.now()
      });
    }
  }

  private handleDiscoveryMessage(data: any) {
    if (data.from === this.localId) return;

    if (data.type === 'ANNOUNCE') {
      // Found another device
      const device: MeshDevice = {
        id: data.from,
        name: data.name || `WebRTC-${data.from.slice(0, 4)}`,
        signalStrength: 85,
        distance: 0,
        angle: Math.random() * 360,
        isConnected: false,
        lastSeen: new Date(),
        type: 'phone',
        connectionType: 'network',
        bluetoothEnabled: false
      };
      multiTransportMesh.addDiscoveredDevice(device);

      // Try to connect
      if (!this.connections.has(data.from)) {
        this.initiateConnection(data.from);
      }
    } else if (data.type === 'SIGNAL' && data.to === this.localId) {
      this.handleSignalData(data.from, data.signal);
    }
  }

  /**
   * Initiate a WebRTC connection to another peer
   */
  public initiateConnection(peerId: string): void {
    if (this.connections.has(peerId)) return;

    const peer = new Peer({
      initiator: true,
      trickle: true,
      config: { iceServers: ICE_SERVERS }
    });

    this.setupPeerEvents(peer, peerId, true);

    this.connections.set(peerId, {
      peer,
      peerId,
      isInitiator: true,
      connected: false
    });
  }

  /**
   * Accept an incoming connection
   */
  public acceptConnection(peerId: string, signalData: SignalData): void {
    let conn = this.connections.get(peerId);

    if (!conn) {
      const peer = new Peer({
        initiator: false,
        trickle: true,
        config: { iceServers: ICE_SERVERS }
      });

      this.setupPeerEvents(peer, peerId, false);

      conn = {
        peer,
        peerId,
        isInitiator: false,
        connected: false
      };
      this.connections.set(peerId, conn);
    }

    conn.peer.signal(signalData);
  }

  private setupPeerEvents(peer: SimplePeerInstance, peerId: string, isInitiator: boolean) {
    peer.on('signal', (signal) => {
      // Send signal to the peer via discovery channel or other means
      if (this.discoveryChannel) {
        this.discoveryChannel.postMessage({
          type: 'SIGNAL',
          from: this.localId,
          to: peerId,
          signal
        });
      }

      // Store for manual exchange
      const conn = this.connections.get(peerId);
      if (conn) {
        conn.signalData = signal;
      }
    });

    peer.on('connect', () => {
      console.log(`WebRTC connected to ${peerId}`);
      const conn = this.connections.get(peerId);
      if (conn) {
        conn.connected = true;
      }

      // Register with mesh core
      const peerInfo: PeerInfo = {
        id: peerId,
        name: `Peer-${peerId.slice(0, 4)}`,
        transport: 'webrtc',
        lastSeen: Date.now(),
        connection: {
          send: (data: Uint8Array) => {
            if (peer.connected) {
              peer.send(data);
            }
          }
        }
      };
      multiTransportMesh.addPeer(peerInfo);

      // Announce ourselves
      multiTransportMesh.announcePresence();

      // Update device status
      const device = multiTransportMesh.getDevice(peerId);
      if (device) {
        const updated = { ...device, isConnected: true, lastSeen: new Date() };
        multiTransportMesh.addDiscoveredDevice(updated);
      }
    });

    peer.on('data', (data: Uint8Array) => {
      try {
        const buffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
        const packet = decodePacket(buffer);
        if (packet) {
          multiTransportMesh.handleReceivedPacket(packet, 'webrtc');
        }
      } catch (e) {
        console.log('Failed to process WebRTC data:', e);
      }
    });

    peer.on('close', () => {
      console.log(`WebRTC connection closed: ${peerId}`);
      this.connections.delete(peerId);
      multiTransportMesh.removePeer(peerId);
    });

    peer.on('error', (err) => {
      console.error(`WebRTC error with ${peerId}:`, err);
      this.connections.delete(peerId);
    });
  }

  private handleSignalData(peerId: string, signal: SignalData) {
    const conn = this.connections.get(peerId);
    
    if (conn) {
      conn.peer.signal(signal);
    } else {
      // Store pending signal and accept connection
      this.acceptConnection(peerId, signal);
    }
  }

  /**
   * Get signal data for manual exchange (QR code, copy/paste)
   */
  public getSignalForPeer(peerId: string): SignalData | undefined {
    return this.connections.get(peerId)?.signalData;
  }

  /**
   * Process manually entered signal data
   */
  public processManualSignal(peerId: string, signalData: SignalData): void {
    this.handleSignalData(peerId, signalData);
  }

  /**
   * Send data to a specific peer
   */
  public sendToPeer(peerId: string, data: Uint8Array): boolean {
    const conn = this.connections.get(peerId);
    if (conn?.connected) {
      try {
        conn.peer.send(data);
        return true;
      } catch (e) {
        console.error('Send error:', e);
        return false;
      }
    }
    return false;
  }

  /**
   * Broadcast to all connected peers
   */
  public broadcast(data: Uint8Array): void {
    for (const [peerId, conn] of this.connections) {
      if (conn.connected) {
        try {
          conn.peer.send(data);
        } catch (e) {
          console.log(`Failed to broadcast to ${peerId}:`, e);
        }
      }
    }
  }

  public getConnectedPeers(): string[] {
    return Array.from(this.connections.entries())
      .filter(([_, conn]) => conn.connected)
      .map(([id]) => id);
  }

  public cleanup(): void {
    for (const [_, conn] of this.connections) {
      try {
        conn.peer.destroy();
      } catch (e) {
        // Ignore
      }
    }
    this.connections.clear();
    
    if (this.discoveryChannel) {
      this.discoveryChannel.close();
    }
  }
}

export const webRTCMesh = new WebRTCMeshService();
