// Local Mesh Service - Handles all local (offline) mesh networking
// Works without any internet connection using BroadcastChannel, WebRTC, and native transports

import { MeshDevice, MeshMessage } from '@/types/mesh';
import { offlineStorage } from './OfflineStorageService';
import { MeshPacket, createPacket, decodePacket, encodePacket, verifyPacket } from './MeshProtocol';
import { detectDeviceInfo } from '@/utils/deviceDetection';

interface LocalMeshEvents {
  onDeviceDiscovered: (device: MeshDevice) => void;
  onDeviceUpdated: (device: MeshDevice) => void;
  onDeviceLost: (deviceId: string) => void;
  onMessageReceived: (message: MeshMessage) => void;
  onMessageDelivered: (messageId: string) => void;
  onConnectionStateChanged: (connected: boolean) => void;
}

interface PeerConnection {
  id: string;
  name: string;
  channel: 'broadcast' | 'webrtc' | 'bluetooth' | 'wifi';
  lastSeen: number;
  connection?: RTCDataChannel | any;
}

/**
 * LocalMeshService - Handles all offline-capable mesh networking
 * Uses multiple transport layers that work without internet
 */
class LocalMeshService {
  private localDeviceId = '';
  private localDeviceName = '';
  private isInitialized = false;
  
  // BroadcastChannel for same-origin communication
  private broadcastChannel: BroadcastChannel | null = null;
  
  // Connected peers across all transports
  private peers: Map<string, PeerConnection> = new Map();
  private discoveredDevices: Map<string, MeshDevice> = new Map();
  
  // Message handling
  private processedMessages: Set<string> = new Set();
  private pendingAcks: Map<string, { message: MeshMessage; timer: NodeJS.Timeout; retries: number }> = new Map();
  
  // Event handlers
  private events: Partial<LocalMeshEvents> = {};
  
  // Intervals
  private presenceInterval: NodeJS.Timeout | null = null;
  private cleanupInterval: NodeJS.Timeout | null = null;

  setEventHandler<K extends keyof LocalMeshEvents>(event: K, handler: LocalMeshEvents[K]) {
    this.events[event] = handler;
  }

  async initialize(deviceId: string, deviceName: string): Promise<boolean> {
    if (this.isInitialized) return true;

    this.localDeviceId = deviceId;
    this.localDeviceName = deviceName;

    try {
      // Initialize offline storage
      await offlineStorage.initialize();

      // Load cached devices
      const cachedDevices = await offlineStorage.getAllDevices();
      cachedDevices.forEach(device => {
        if (!device.isSelf) {
          this.discoveredDevices.set(device.id, device);
        }
      });

      // Setup BroadcastChannel (works across tabs/windows)
      this.setupBroadcastChannel();

      // Start presence announcements
      this.startPresenceAnnouncements();

      // Start cleanup routine
      this.startCleanupRoutine();

      this.isInitialized = true;
      console.log('[LocalMesh] Initialized with device:', deviceId);
      return true;
    } catch (error) {
      console.error('[LocalMesh] Initialization failed:', error);
      return false;
    }
  }

  private setupBroadcastChannel() {
    if (typeof BroadcastChannel === 'undefined') {
      console.log('[LocalMesh] BroadcastChannel not available');
      return;
    }

    try {
      this.broadcastChannel = new BroadcastChannel('meshlink_local_v2');
      
      this.broadcastChannel.onmessage = (event) => {
        this.handleBroadcastMessage(event.data);
      };

      // Announce presence immediately
      this.announcePresence();
      
      console.log('[LocalMesh] BroadcastChannel setup complete');
    } catch (error) {
      console.error('[LocalMesh] BroadcastChannel setup failed:', error);
    }
  }

  private handleBroadcastMessage(data: any) {
    // Ignore our own messages
    if (data.from === this.localDeviceId) return;

    console.log('[LocalMesh] Received broadcast:', data.type, 'from:', data.from);

    switch (data.type) {
      case 'PRESENCE':
        this.handlePresence(data);
        break;
      case 'MESSAGE':
        this.handleIncomingMessage(data);
        break;
      case 'ACK':
        this.handleAck(data);
        break;
      case 'TYPING':
        this.handleTyping(data);
        break;
      case 'PING':
        this.handlePing(data);
        break;
    }
  }

  private handlePresence(data: any) {
    const existingDevice = this.discoveredDevices.get(data.from);
    
    // Use actual device name from the announcing device, not generic names
    let deviceName = data.name || '';
    if (!deviceName || deviceName.startsWith('MeshUser-') || deviceName.startsWith('Device-')) {
      deviceName = `Device-${data.from.slice(0, 4)}`;
    }
    
    const device: MeshDevice = {
      id: data.from,
      name: deviceName,
      signalStrength: 95,
      distance: 1,
      angle: existingDevice?.angle || Math.random() * 360,
      isConnected: true,
      isOnline: true,
      lastSeen: new Date(),
      type: data.deviceType || 'phone',
      connectionType: 'wifi',
      bluetoothEnabled: false,
      isSelf: false,
      isTyping: false
    };

    const isNew = !existingDevice;
    this.discoveredDevices.set(data.from, device);

    // Update peer connection
    this.peers.set(data.from, {
      id: data.from,
      name: device.name,
      channel: 'broadcast',
      lastSeen: Date.now()
    });

    // Save to offline storage
    offlineStorage.saveDevice(device);

    // Emit event
    if (isNew) {
      console.log('[LocalMesh] New device discovered:', device.name, device.id);
      this.events.onDeviceDiscovered?.(device);
    } else {
      this.events.onDeviceUpdated?.(device);
    }

    // Send our presence back if this is a new peer
    if (isNew) {
      this.announcePresence();
    }
  }

  private handleIncomingMessage(data: any) {
    // Check if this message is for us
    if (data.to !== this.localDeviceId && data.to !== '*') return;

    // Check for duplicate
    if (this.processedMessages.has(data.id)) return;
    this.processedMessages.add(data.id);

    // Create message object
    const message: MeshMessage = {
      id: data.id,
      content: data.content,
      senderId: data.from,
      receiverId: this.localDeviceId,
      timestamp: new Date(data.timestamp || Date.now()),
      hops: data.hops || [data.from],
      status: 'delivered'
    };

    // Save to offline storage
    offlineStorage.saveMessage(message, false);

    // Emit event
    this.events.onMessageReceived?.(message);

    // Send acknowledgment
    this.sendAck(data.id, data.from);
  }

  private handleAck(data: any) {
    if (data.to !== this.localDeviceId) return;

    const pending = this.pendingAcks.get(data.messageId);
    if (pending) {
      clearTimeout(pending.timer);
      this.pendingAcks.delete(data.messageId);
      
      // Update message status
      offlineStorage.updateMessageStatus(data.messageId, 'delivered');
      offlineStorage.removeFromPendingQueue(data.messageId);
      
      this.events.onMessageDelivered?.(data.messageId);
    }
  }

  private handleTyping(data: any) {
    if (data.to !== this.localDeviceId && data.to !== '*') return;

    const device = this.discoveredDevices.get(data.from);
    if (device) {
      const updated = { ...device, isTyping: data.isTyping };
      this.discoveredDevices.set(data.from, updated);
      this.events.onDeviceUpdated?.(updated);
    }
  }

  private handlePing(data: any) {
    const device = this.discoveredDevices.get(data.from);
    if (device) {
      const updated = { ...device, lastSeen: new Date(), isOnline: true };
      this.discoveredDevices.set(data.from, updated);
    }
  }

  private announcePresence() {
    if (!this.broadcastChannel) return;

    // Get device type from detection
    const deviceInfo = detectDeviceInfo();

    this.broadcastChannel.postMessage({
      type: 'PRESENCE',
      from: this.localDeviceId,
      name: this.localDeviceName,
      deviceType: deviceInfo.type,
      deviceBrand: deviceInfo.brand,
      deviceOS: deviceInfo.os,
      timestamp: Date.now()
    });
  }

  private sendAck(messageId: string, to: string) {
    if (!this.broadcastChannel) return;

    this.broadcastChannel.postMessage({
      type: 'ACK',
      from: this.localDeviceId,
      to,
      messageId,
      timestamp: Date.now()
    });
  }

  private startPresenceAnnouncements() {
    if (this.presenceInterval) {
      clearInterval(this.presenceInterval);
    }

    this.presenceInterval = setInterval(() => {
      this.announcePresence();
      this.checkPeerStatus();
    }, 3000);
  }

  private checkPeerStatus() {
    const now = Date.now();
    const timeout = 15000; // 15 seconds
    const removeTimeout = 60000; // 1 minute

    for (const [id, peer] of this.peers) {
      const device = this.discoveredDevices.get(id);
      
      if (now - peer.lastSeen > removeTimeout) {
        // Remove peer
        this.peers.delete(id);
        if (device) {
          this.discoveredDevices.delete(id);
          this.events.onDeviceLost?.(id);
        }
      } else if (now - peer.lastSeen > timeout) {
        // Mark as offline
        if (device && device.isOnline) {
          const updated = { ...device, isOnline: false, isConnected: false };
          this.discoveredDevices.set(id, updated);
          this.events.onDeviceUpdated?.(updated);
        }
      }
    }
  }

  private startCleanupRoutine() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }

    this.cleanupInterval = setInterval(() => {
      // Clean processed messages (keep last 1000)
      if (this.processedMessages.size > 1000) {
        const arr = Array.from(this.processedMessages);
        this.processedMessages = new Set(arr.slice(-500));
      }

      // Retry pending messages
      this.retryPendingMessages();
    }, 10000);
  }

  private async retryPendingMessages() {
    const pending = await offlineStorage.getPendingMessages();
    
    for (const item of pending) {
      if (item.retries >= 30) {
        // Max retries reached, mark as failed
        await offlineStorage.updateMessageStatus(item.id, 'failed');
        await offlineStorage.removeFromPendingQueue(item.id);
        continue;
      }

      // Check if peer is online
      const peer = this.peers.get(item.message.receiverId);
      if (peer && Date.now() - peer.lastSeen < 15000) {
        // Peer is online, retry sending
        this.sendMessageViaBroadcast(item.message);
        await offlineStorage.updatePendingRetry(item.id);
      }
    }
  }

  // ============ PUBLIC API ============\\

  async sendMessage(content: string, receiverId: string): Promise<string> {
    const messageId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    const message: MeshMessage = {
      id: messageId,
      content,
      senderId: this.localDeviceId,
      receiverId,
      timestamp: new Date(),
      hops: [this.localDeviceId],
      status: 'sending'
    };

    // Save to offline storage immediately
    await offlineStorage.saveMessage(message, false);

    // Try to send via all available channels
    const sent = this.sendMessageViaBroadcast(message);
    
    if (sent) {
      message.status = 'sent';
      await offlineStorage.saveMessage(message);

      // Setup retry with acknowledgment
      const timer = setTimeout(async () => {
        // If no ack received, add to pending queue
        if (this.pendingAcks.has(messageId)) {
          await offlineStorage.addToPendingQueue(message);
        }
      }, 5000);

      this.pendingAcks.set(messageId, { message, timer, retries: 0 });
    } else {
      // No channel available, queue for later
      message.status = 'queued';
      await offlineStorage.saveMessage(message);
      await offlineStorage.addToPendingQueue(message);
    }

    return messageId;
  }

  private sendMessageViaBroadcast(message: MeshMessage): boolean {
    if (!this.broadcastChannel) return false;

    try {
      this.broadcastChannel.postMessage({
        type: 'MESSAGE',
        id: message.id,
        from: this.localDeviceId,
        to: message.receiverId,
        content: message.content,
        timestamp: message.timestamp.getTime(),
        hops: message.hops
      });
      return true;
    } catch (error) {
      console.error('[LocalMesh] Failed to send via broadcast:', error);
      return false;
    }
  }

  sendTypingIndicator(receiverId: string, isTyping: boolean) {
    if (!this.broadcastChannel) return;

    this.broadcastChannel.postMessage({
      type: 'TYPING',
      from: this.localDeviceId,
      to: receiverId,
      isTyping,
      timestamp: Date.now()
    });
  }

  getDevices(): MeshDevice[] {
    return Array.from(this.discoveredDevices.values());
  }

  getDevice(deviceId: string): MeshDevice | undefined {
    return this.discoveredDevices.get(deviceId);
  }

  getPeers(): PeerConnection[] {
    return Array.from(this.peers.values());
  }

  isDeviceOnline(deviceId: string): boolean {
    const peer = this.peers.get(deviceId);
    return peer ? Date.now() - peer.lastSeen < 15000 : false;
  }

  getLocalDeviceId(): string {
    return this.localDeviceId;
  }

  getLocalDeviceName(): string {
    return this.localDeviceName;
  }

  async loadCachedMessages(): Promise<MeshMessage[]> {
    return offlineStorage.getAllMessages(this.localDeviceId);
  }

  async loadCachedDevices(): Promise<MeshDevice[]> {
    return offlineStorage.getAllDevices();
  }

  cleanup() {
    if (this.presenceInterval) {
      clearInterval(this.presenceInterval);
    }
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
    if (this.broadcastChannel) {
      this.broadcastChannel.close();
    }

    for (const [, pending] of this.pendingAcks) {
      clearTimeout(pending.timer);
    }
    this.pendingAcks.clear();
    this.peers.clear();
    this.discoveredDevices.clear();
    this.processedMessages.clear();
    this.isInitialized = false;
  }
}

export const localMesh = new LocalMeshService();
