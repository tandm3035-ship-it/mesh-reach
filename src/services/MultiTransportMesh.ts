// Multi-Transport Mesh Service
// Combines BLE, WiFi P2P, WebRTC, and Network for maximum connectivity

import { MeshDevice, MeshMessage, ConnectionType } from '@/types/mesh';
import { MeshPacket, createPacket, decodePacket, encodePacket, verifyPacket, shouldRelay, prepareForRelay, generateDeviceId, MESH_NAME_PREFIX } from './MeshProtocol';
import { Preferences } from '@capacitor/preferences';
import { Capacitor } from '@capacitor/core';

// Dynamic import for local notifications (only available on native)
let LocalNotifications: any = null;
const loadLocalNotifications = async () => {
  if (Capacitor.isNativePlatform() && !LocalNotifications) {
    try {
      const module = await import('@capacitor/local-notifications');
      LocalNotifications = module.LocalNotifications;
    } catch (e) {
      console.log('Local notifications not available');
    }
  }
  return LocalNotifications;
};

export type TransportType = 'bluetooth' | 'wifi-direct' | 'webrtc' | 'network' | 'ultrasonic' | 'nfc';

export interface TransportStatus {
  type: TransportType;
  available: boolean;
  enabled: boolean;
  devices: number;
  error?: string;
}

export interface MeshEvents {
  onDeviceDiscovered: (device: MeshDevice) => void;
  onDeviceUpdated: (device: MeshDevice) => void;
  onDeviceLost: (deviceId: string) => void;
  onMessageReceived: (message: MeshMessage) => void;
  onMessageStatusChanged: (messageId: string, status: MeshMessage['status']) => void;
  onTransportStatusChanged: (status: TransportStatus) => void;
  onError: (error: string, transport?: TransportType) => void;
  onScanStateChanged: (isScanning: boolean) => void;
}

export interface PeerInfo {
  id: string;
  name: string;
  transport: TransportType;
  address?: string;
  rssi?: number;
  lastSeen: number;
  connection?: any;
}

/**
 * MultiTransportMeshService - The core mesh networking engine
 * Uses ALL available transports to discover devices and send messages
 */
export class MultiTransportMeshService {
  private localDeviceId: string = '';
  private localDeviceName: string = '';
  private isInitialized: boolean = false;
  private isScanning: boolean = false;
  
  // Discovered devices from all transports
  private discoveredDevices: Map<string, MeshDevice> = new Map();
  private peers: Map<string, PeerInfo> = new Map();
  
  // Message handling
  private messageQueue: Map<string, MeshPacket> = new Map();
  private processedPackets: Set<string> = new Set();
  private pendingAcks: Map<string, { packet: MeshPacket; retries: number; timer: NodeJS.Timeout }> = new Map();
  
  // Transport statuses
  private transportStatuses: Map<TransportType, TransportStatus> = new Map();
  
  // Event handlers
  private events: Partial<MeshEvents> = {};
  
  // Intervals
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private discoveryInterval: NodeJS.Timeout | null = null;
  
  // Store delivered messages for notification
  private deliveredNotificationIds: Set<string> = new Set();

  constructor() {
    this.initializeTransportStatuses();
  }

  private initializeTransportStatuses() {
    const transports: TransportType[] = ['bluetooth', 'wifi-direct', 'webrtc', 'network', 'nfc'];
    transports.forEach(t => {
      this.transportStatuses.set(t, {
        type: t,
        available: false,
        enabled: false,
        devices: 0
      });
    });
  }

  public setEventHandler<K extends keyof MeshEvents>(event: K, handler: MeshEvents[K]) {
    this.events[event] = handler;
  }

  private async loadDeviceId(): Promise<void> {
    try {
      const { value } = await Preferences.get({ key: 'mesh_device_id' });
      if (value) {
        this.localDeviceId = value;
      } else {
        this.localDeviceId = generateDeviceId();
        await Preferences.set({ key: 'mesh_device_id', value: this.localDeviceId });
      }
      
      const { value: name } = await Preferences.get({ key: 'mesh_device_name' });
      this.localDeviceName = name || `${MESH_NAME_PREFIX}${this.localDeviceId}`;
    } catch (e) {
      this.localDeviceId = generateDeviceId();
      this.localDeviceName = `${MESH_NAME_PREFIX}${this.localDeviceId}`;
    }
  }

  public getLocalDeviceId(): string {
    return this.localDeviceId;
  }

  public getLocalDeviceName(): string {
    return this.localDeviceName;
  }

  public async setDeviceName(name: string): Promise<void> {
    this.localDeviceName = name;
    await Preferences.set({ key: 'mesh_device_name', value: name });
  }

  public async initialize(): Promise<boolean> {
    if (this.isInitialized) return true;

    try {
      await this.loadDeviceId();
      
      // Request notification permissions
      if (Capacitor.isNativePlatform()) {
        try {
          const notifications = await loadLocalNotifications();
          if (notifications) {
            const permission = await notifications.requestPermissions();
            console.log('Notification permission:', permission);
          }
        } catch (e) {
          console.log('Notifications not available:', e);
        }
      }

      // Start heartbeat for maintaining connections
      this.startHeartbeat();
      
      this.isInitialized = true;
      return true;
    } catch (error) {
      console.error('Failed to initialize MultiTransportMesh:', error);
      this.events.onError?.(`Initialization failed: ${error}`);
      return false;
    }
  }

  private startHeartbeat() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
    }

    this.heartbeatInterval = setInterval(() => {
      this.updateDeviceStatuses();
      this.retryPendingMessages();
      this.cleanupOldPackets();
    }, 5000);
  }

  private updateDeviceStatuses() {
    const now = Date.now();
    const timeout = 60000; // 60 seconds
    const removeTimeout = 180000; // 3 minutes

    for (const [id, device] of this.discoveredDevices) {
      const lastSeen = device.lastSeen.getTime();

      if (now - lastSeen > removeTimeout) {
        this.discoveredDevices.delete(id);
        this.peers.delete(id);
        this.events.onDeviceLost?.(id);
      } else if (now - lastSeen > timeout && device.isConnected) {
        const updated = { ...device, isConnected: false };
        this.discoveredDevices.set(id, updated);
        this.events.onDeviceUpdated?.(updated);
      }
    }
  }

  private async retryPendingMessages() {
    for (const [messageId, pending] of this.pendingAcks) {
      if (pending.retries >= 20) {
        // Max retries reached
        clearTimeout(pending.timer);
        this.pendingAcks.delete(messageId);
        this.messageQueue.delete(messageId);
        this.events.onMessageStatusChanged?.(messageId, 'failed');
        continue;
      }

      // Retry sending
      pending.retries++;
      await this.broadcastPacket(pending.packet);
    }
  }

  private cleanupOldPackets() {
    // Keep only last 2000 processed packet IDs
    if (this.processedPackets.size > 2000) {
      const arr = Array.from(this.processedPackets);
      this.processedPackets = new Set(arr.slice(-1000));
    }
  }

  /**
   * Add a discovered device from any transport
   */
  public addDiscoveredDevice(device: MeshDevice): void {
    const existing = this.discoveredDevices.get(device.id);
    
    if (existing) {
      // Update existing device, merge information
      const updated: MeshDevice = {
        ...existing,
        ...device,
        signalStrength: Math.max(existing.signalStrength, device.signalStrength),
        lastSeen: new Date(),
        isConnected: existing.isConnected || device.isConnected
      };
      this.discoveredDevices.set(device.id, updated);
      this.events.onDeviceUpdated?.(updated);
    } else {
      this.discoveredDevices.set(device.id, device);
      this.events.onDeviceDiscovered?.(device);
    }
  }

  /**
   * Handle received mesh packet from any transport
   */
  public async handleReceivedPacket(packet: MeshPacket, fromTransport: TransportType): Promise<void> {
    // Verify packet integrity
    if (!verifyPacket(packet)) {
      console.log('Invalid packet signature, dropping');
      return;
    }

    // Check for duplicate
    if (this.processedPackets.has(packet.id)) {
      return;
    }
    this.processedPackets.add(packet.id);

    // Process based on type
    switch (packet.type) {
      case 'MESSAGE':
        await this.handleMessagePacket(packet, fromTransport);
        break;
      case 'ACK':
        this.handleAckPacket(packet);
        break;
      case 'DISCOVER':
      case 'ANNOUNCE':
        this.handleDiscoveryPacket(packet, fromTransport);
        break;
      case 'PING':
        this.handlePingPacket(packet, fromTransport);
        break;
    }

    // Relay if needed
    if (shouldRelay(packet, this.localDeviceId)) {
      const relayPacket = prepareForRelay(packet, this.localDeviceId);
      await this.broadcastPacket(relayPacket);
    }
  }

  private async handleMessagePacket(packet: MeshPacket, fromTransport: TransportType): Promise<void> {
    if (packet.targetId === this.localDeviceId || packet.targetId === '*') {
      // Message is for us!
      const message: MeshMessage = {
        id: packet.id,
        content: packet.payload,
        senderId: packet.originalSenderId,
        receiverId: this.localDeviceId,
        timestamp: new Date(packet.timestamp),
        hops: packet.hops,
        status: 'delivered'
      };

      // Show notification
      await this.showMessageNotification(message);

      this.events.onMessageReceived?.(message);

      // Send acknowledgment
      await this.sendAck(packet);
    }
  }

  private async showMessageNotification(message: MeshMessage): Promise<void> {
    if (!Capacitor.isNativePlatform()) return;
    if (this.deliveredNotificationIds.has(message.id)) return;

    this.deliveredNotificationIds.add(message.id);

    try {
      const notifications = await loadLocalNotifications();
      if (!notifications) return;

      await notifications.schedule({
        notifications: [
          {
            title: `Message from ${message.senderId.slice(0, 6)}...`,
            body: message.content.slice(0, 100),
            id: Math.abs(hashString(message.id)) % 2147483647,
            schedule: { at: new Date(Date.now()) },
            sound: undefined,
            smallIcon: 'ic_notification',
            largeIcon: 'ic_notification',
            extra: {
              messageId: message.id,
              senderId: message.senderId
            }
          }
        ]
      });
    } catch (e) {
      console.log('Could not show notification:', e);
    }
  }

  private handleAckPacket(packet: MeshPacket): void {
    const originalId = packet.payload;
    const pending = this.pendingAcks.get(originalId);
    
    if (pending) {
      clearTimeout(pending.timer);
      this.pendingAcks.delete(originalId);
      this.messageQueue.delete(originalId);
      this.events.onMessageStatusChanged?.(originalId, 'delivered');
    }
  }

  private handleDiscoveryPacket(packet: MeshPacket, fromTransport: TransportType): void {
    try {
      const deviceInfo = JSON.parse(packet.payload);
      
      const device: MeshDevice = {
        id: packet.originalSenderId,
        name: deviceInfo.name || `Device-${packet.originalSenderId.slice(0, 4)}`,
        signalStrength: deviceInfo.signalStrength || 70,
        distance: deviceInfo.distance || 10,
        angle: Math.random() * 360,
        isConnected: true,
        lastSeen: new Date(),
        type: deviceInfo.type || 'phone',
        connectionType: fromTransport as ConnectionType,
        bluetoothEnabled: true
      };

      this.addDiscoveredDevice(device);
    } catch (e) {
      console.log('Failed to parse discovery packet:', e);
    }
  }

  private handlePingPacket(packet: MeshPacket, fromTransport: TransportType): void {
    const device = this.discoveredDevices.get(packet.senderId);
    if (device) {
      const updated = { ...device, lastSeen: new Date(), isConnected: true };
      this.discoveredDevices.set(packet.senderId, updated);
      this.events.onDeviceUpdated?.(updated);
    }
  }

  private async sendAck(originalPacket: MeshPacket): Promise<void> {
    const ackPacket = createPacket(
      'ACK',
      this.localDeviceId,
      originalPacket.originalSenderId,
      originalPacket.id
    );
    await this.broadcastPacket(ackPacket);
  }

  /**
   * Send a message through the mesh network
   */
  public async sendMessage(content: string, receiverId: string): Promise<string> {
    const packet = createPacket(
      'MESSAGE',
      this.localDeviceId,
      receiverId,
      content
    );

    // Add to queue for retry
    this.messageQueue.set(packet.id, packet);

    // Set up retry mechanism with exponential backoff
    const scheduleRetry = (retries: number) => {
      const timer = setTimeout(async () => {
        const pending = this.pendingAcks.get(packet.id);
        if (pending && pending.retries < 20) {
          pending.retries++;
          await this.broadcastPacket(packet);
          scheduleRetry(pending.retries);
        }
      }, Math.min(2000 * Math.pow(1.5, retries), 60000));

      this.pendingAcks.set(packet.id, { packet, retries, timer });
    };

    // Send immediately
    await this.broadcastPacket(packet);
    scheduleRetry(0);

    return packet.id;
  }

  /**
   * Broadcast a packet through ALL available transports
   */
  public async broadcastPacket(packet: MeshPacket): Promise<void> {
    const buffer = encodePacket(packet);
    const data = new Uint8Array(buffer instanceof ArrayBuffer ? buffer : new ArrayBuffer(0));

    // Get all connected peers and broadcast
    for (const [peerId, peer] of this.peers) {
      if (peer.connection && typeof peer.connection.send === 'function') {
        try {
          await peer.connection.send(data);
        } catch (e) {
          console.log(`Failed to send to ${peerId} via ${peer.transport}:`, e);
        }
      }
    }

    // Emit event for transport handlers to send
    // Each transport service should listen and send through their specific channel
  }

  /**
   * Announce presence to the network
   */
  public async announcePresence(): Promise<void> {
    const packet = createPacket(
      'ANNOUNCE',
      this.localDeviceId,
      '*',
      JSON.stringify({
        name: this.localDeviceName,
        capabilities: ['MESSAGE', 'RELAY', 'ACK'],
        version: '1.0.0'
      })
    );
    await this.broadcastPacket(packet);
  }

  /**
   * Send discovery request
   */
  public async sendDiscovery(): Promise<void> {
    const packet = createPacket(
      'DISCOVER',
      this.localDeviceId,
      '*',
      JSON.stringify({
        name: this.localDeviceName,
        type: 'phone',
        signalStrength: 100
      })
    );
    await this.broadcastPacket(packet);
  }

  public getDevices(): MeshDevice[] {
    return Array.from(this.discoveredDevices.values());
  }

  public getDevice(deviceId: string): MeshDevice | undefined {
    return this.discoveredDevices.get(deviceId);
  }

  public getTransportStatuses(): TransportStatus[] {
    return Array.from(this.transportStatuses.values());
  }

  public updateTransportStatus(type: TransportType, status: Partial<TransportStatus>): void {
    const current = this.transportStatuses.get(type);
    if (current) {
      const updated = { ...current, ...status };
      this.transportStatuses.set(type, updated);
      this.events.onTransportStatusChanged?.(updated);
    }
  }

  public addPeer(peer: PeerInfo): void {
    this.peers.set(peer.id, peer);
  }

  public removePeer(peerId: string): void {
    this.peers.delete(peerId);
  }

  public getPeers(): PeerInfo[] {
    return Array.from(this.peers.values());
  }

  public setScanning(scanning: boolean): void {
    this.isScanning = scanning;
    this.events.onScanStateChanged?.(scanning);
  }

  public isCurrentlyScanning(): boolean {
    return this.isScanning;
  }

  public async cleanup(): Promise<void> {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
    }
    if (this.discoveryInterval) {
      clearInterval(this.discoveryInterval);
    }

    // Clear all pending retries
    for (const [, pending] of this.pendingAcks) {
      clearTimeout(pending.timer);
    }
    this.pendingAcks.clear();
    this.peers.clear();
    this.discoveredDevices.clear();
    this.isInitialized = false;
  }
}

// Simple string hash for notification IDs
function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return hash;
}

// Singleton instance
export const multiTransportMesh = new MultiTransportMeshService();
