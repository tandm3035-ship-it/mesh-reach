// Smart Transport Selector
// Intelligently chooses the best transport for each message based on:
// - Latency, reliability, and availability
// - Peer connectivity status across different transports
// - Power efficiency and bandwidth

import { ConnectionType } from '@/types/mesh';
import { localMesh } from './LocalMeshService';
import { globalMeshRelay } from './GlobalMeshRelay';
import { webRTCMesh } from './WebRTCMeshService';
import { offlineStorage } from './OfflineStorageService';

interface TransportMetrics {
  type: ConnectionType;
  latency: number; // milliseconds
  reliability: number; // 0-100
  isAvailable: boolean;
  deviceCount: number;
  lastSuccess: number; // timestamp
  failureCount: number;
}

interface TransportDecision {
  primary: ConnectionType;
  fallbacks: ConnectionType[];
  reason: string;
}

/**
 * SmartTransportSelector
 * Analyzes network conditions and peer status to select optimal transport
 */
class SmartTransportSelectorService {
  private metrics: Map<ConnectionType, TransportMetrics> = new Map();
  private peerTransports: Map<string, ConnectionType[]> = new Map();
  
  constructor() {
    this.initializeMetrics();
  }

  private initializeMetrics() {
    const transports: ConnectionType[] = ['bluetooth', 'wifi', 'webrtc', 'network'];
    
    transports.forEach(type => {
      this.metrics.set(type, {
        type,
        latency: type === 'bluetooth' ? 50 : type === 'wifi' ? 20 : type === 'webrtc' ? 100 : 200,
        reliability: 80,
        isAvailable: false,
        deviceCount: 0,
        lastSuccess: 0,
        failureCount: 0
      });
    });
  }

  updateTransportAvailability(type: ConnectionType, isAvailable: boolean, deviceCount: number = 0) {
    const metric = this.metrics.get(type);
    if (metric) {
      metric.isAvailable = isAvailable;
      metric.deviceCount = deviceCount;
      this.metrics.set(type, metric);
    }
  }

  recordSuccess(type: ConnectionType) {
    const metric = this.metrics.get(type);
    if (metric) {
      metric.lastSuccess = Date.now();
      metric.failureCount = Math.max(0, metric.failureCount - 1);
      metric.reliability = Math.min(100, metric.reliability + 5);
      this.metrics.set(type, metric);
    }
  }

  recordFailure(type: ConnectionType) {
    const metric = this.metrics.get(type);
    if (metric) {
      metric.failureCount++;
      metric.reliability = Math.max(0, metric.reliability - 10);
      this.metrics.set(type, metric);
    }
  }

  updatePeerTransports(peerId: string, transports: ConnectionType[]) {
    this.peerTransports.set(peerId, transports);
  }

  /**
   * Select the best transport for sending a message to a specific peer
   */
  selectTransportForPeer(peerId: string): TransportDecision {
    const peerTransports = this.peerTransports.get(peerId) || [];
    const availableTransports = Array.from(this.metrics.values())
      .filter(m => m.isAvailable)
      .sort((a, b) => {
        // Score based on multiple factors
        const scoreA = this.calculateScore(a, peerTransports);
        const scoreB = this.calculateScore(b, peerTransports);
        return scoreB - scoreA; // Higher score is better
      });

    if (availableTransports.length === 0) {
      // No transports available - use offline queue
      return {
        primary: 'unknown',
        fallbacks: [],
        reason: 'No transports available - message will be queued'
      };
    }

    const primary = availableTransports[0];
    const fallbacks = availableTransports.slice(1, 3).map(t => t.type);

    return {
      primary: primary.type,
      fallbacks,
      reason: this.getReasonText(primary)
    };
  }

  private calculateScore(metric: TransportMetrics, peerSupports: ConnectionType[]): number {
    let score = 0;

    // Availability is mandatory
    if (!metric.isAvailable) return -1000;

    // Reliability is most important (0-100)
    score += metric.reliability;

    // Lower latency is better (invert and scale)
    score += Math.max(0, 50 - metric.latency / 10);

    // Peer supports this transport (big bonus)
    if (peerSupports.includes(metric.type)) {
      score += 50;
    }

    // Recent success bonus
    const sinceSuccess = Date.now() - metric.lastSuccess;
    if (sinceSuccess < 60000) {
      score += 30;
    } else if (sinceSuccess < 300000) {
      score += 15;
    }

    // Failure penalty
    score -= metric.failureCount * 10;

    // Device count bonus (mesh has more paths)
    score += Math.min(20, metric.deviceCount * 2);

    // Transport-specific bonuses
    switch (metric.type) {
      case 'bluetooth':
        // Best for nearby, offline
        score += 10;
        break;
      case 'wifi':
        // Fast, local network
        score += 15;
        break;
      case 'webrtc':
        // P2P, works over internet
        score += 20;
        break;
      case 'network':
        // Always-on fallback
        score += 5;
        break;
    }

    return score;
  }

  private getReasonText(metric: TransportMetrics): string {
    switch (metric.type) {
      case 'bluetooth':
        return 'Using Bluetooth for direct nearby communication';
      case 'wifi':
        return 'Using WiFi for fast local network transfer';
      case 'webrtc':
        return 'Using WebRTC for P2P internet connection';
      case 'network':
        return 'Using global relay for worldwide reach';
      default:
        return 'Using best available transport';
    }
  }

  /**
   * Execute message send through selected transport with automatic fallback
   */
  async sendWithFallback(
    content: string,
    receiverId: string,
    messageId: string
  ): Promise<{ success: boolean; transport: ConnectionType; error?: string }> {
    const decision = this.selectTransportForPeer(receiverId);
    const allTransports = [decision.primary, ...decision.fallbacks];
    
    console.log('[SmartTransport] Decision:', decision.reason, 'Transports:', allTransports);

    for (const transport of allTransports) {
      if (transport === 'unknown') continue;

      try {
        const success = await this.sendViaTransport(content, receiverId, messageId, transport);
        if (success) {
          this.recordSuccess(transport);
          return { success: true, transport };
        }
      } catch (error) {
        console.log(`[SmartTransport] ${transport} failed:`, error);
        this.recordFailure(transport);
      }
    }

    // All transports failed - queue for later
    console.log('[SmartTransport] All transports failed - queuing message');
    return { success: false, transport: 'unknown', error: 'All transports failed' };
  }

  private async sendViaTransport(
    content: string,
    receiverId: string,
    messageId: string,
    transport: ConnectionType
  ): Promise<boolean> {
    switch (transport) {
      case 'bluetooth':
      case 'wifi':
        // Local mesh handles both
        try {
          await localMesh.sendMessage(content, receiverId);
          return true;
        } catch {
          return false;
        }

      case 'webrtc':
        // Try WebRTC P2P
        const connectedPeers = webRTCMesh.getConnectedPeers();
        if (connectedPeers.includes(receiverId)) {
          // Send directly via WebRTC
          const data = new TextEncoder().encode(JSON.stringify({
            type: 'MESSAGE',
            id: messageId,
            content,
            from: localMesh.getLocalDeviceId(),
            to: receiverId
          }));
          return webRTCMesh.sendToPeer(receiverId, data);
        }
        return false;

      case 'network':
        // Global relay via Supabase
        if (globalMeshRelay.getIsOnline()) {
          await globalMeshRelay.sendMessage(content, receiverId);
          return true;
        }
        return false;

      default:
        return false;
    }
  }

  getMetrics(): Map<ConnectionType, TransportMetrics> {
    return this.metrics;
  }

  getAvailableTransports(): ConnectionType[] {
    return Array.from(this.metrics.values())
      .filter(m => m.isAvailable)
      .map(m => m.type);
  }

  getTransportStatus(): { type: ConnectionType; available: boolean; reliability: number }[] {
    return Array.from(this.metrics.values()).map(m => ({
      type: m.type,
      available: m.isAvailable,
      reliability: m.reliability
    }));
  }
}

export const smartTransport = new SmartTransportSelectorService();
