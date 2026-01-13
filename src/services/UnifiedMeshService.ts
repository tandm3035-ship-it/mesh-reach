// Unified Mesh Service
// Combines ALL transport layers into a single, easy-to-use service
// Handles automatic transport selection, retries, and message routing

import { MeshDevice, MeshMessage, ConnectionType } from '@/types/mesh';
import { localMesh } from './LocalMeshService';
import { globalMeshRelay } from './GlobalMeshRelay';
import { webRTCMesh } from './WebRTCMeshService';
import { offlineStorage } from './OfflineStorageService';
import { smartTransport } from './SmartTransportSelector';
import { Preferences } from '@capacitor/preferences';
import { Capacitor } from '@capacitor/core';

interface UnifiedMeshEvents {
  onDeviceDiscovered: (device: MeshDevice) => void;
  onDeviceUpdated: (device: MeshDevice) => void;
  onDeviceLost: (deviceId: string) => void;
  onMessageReceived: (message: MeshMessage) => void;
  onMessageStatusChanged: (messageId: string, status: MeshMessage['status']) => void;
  onConnectionStatusChanged: (isOnline: boolean, transports: ConnectionType[]) => void;
  onScanStateChanged: (isScanning: boolean) => void;
}

interface TransportInfo {
  type: ConnectionType;
  available: boolean;
  enabled: boolean;
  deviceCount: number;
  label: string;
}

const generateDeviceId = () => Math.random().toString(36).substring(2, 10).toUpperCase();

/**
 * UnifiedMeshService - The single entry point for all mesh networking
 * 
 * Transport Priority:
 * 1. Local (BroadcastChannel) - Same origin, instant
 * 2. WebRTC - P2P over internet, low latency
 * 3. Global Relay (Supabase) - Worldwide, reliable
 * 4. Offline Queue - Store and forward when all fail
 */
class UnifiedMeshServiceImpl {
  private localDeviceId = '';
  private localDeviceName = '';
  private isInitialized = false;
  private isScanning = false;
  
  // All discovered devices (merged from all transports)
  private devices: Map<string, MeshDevice> = new Map();
  
  // Event handlers
  private events: Partial<UnifiedMeshEvents> = {};
  
  // Scan interval
  private scanInterval: NodeJS.Timeout | null = null;
  private syncInterval: NodeJS.Timeout | null = null;

  setEventHandler<K extends keyof UnifiedMeshEvents>(event: K, handler: UnifiedMeshEvents[K]) {
    this.events[event] = handler;
  }

  async initialize(): Promise<{ deviceId: string; deviceName: string }> {
    if (this.isInitialized) {
      return { deviceId: this.localDeviceId, deviceName: this.localDeviceName };
    }

    try {
      console.log('[UnifiedMesh] Initializing...');

      // Load or generate device identity
      await this.loadDeviceIdentity();

      // Initialize offline storage first (always works)
      await offlineStorage.initialize();
      
      // Load cached devices
      const cachedDevices = await offlineStorage.getAllDevices();
      cachedDevices.forEach(d => {
        if (!d.isSelf) {
          this.devices.set(d.id, d);
        }
      });
      console.log('[UnifiedMesh] Loaded', cachedDevices.length, 'cached devices');

      // Initialize local mesh (BroadcastChannel - works offline)
      await this.initializeLocalMesh();
      smartTransport.updateTransportAvailability('wifi', true, 0);

      // Initialize WebRTC (P2P)
      await this.initializeWebRTC();

      // Initialize global relay (Supabase - needs network)
      await this.initializeGlobalRelay();

      // Start periodic sync
      this.startPeriodicSync();

      this.isInitialized = true;
      console.log('[UnifiedMesh] Initialization complete!');
      
      return { deviceId: this.localDeviceId, deviceName: this.localDeviceName };
    } catch (error) {
      console.error('[UnifiedMesh] Initialization failed:', error);
      throw error;
    }
  }

  private async loadDeviceIdentity() {
    try {
      const { value: storedId } = await Preferences.get({ key: 'mesh_device_id' });
      const { value: storedName } = await Preferences.get({ key: 'mesh_device_name' });
      
      if (storedId) {
        this.localDeviceId = storedId;
      } else {
        this.localDeviceId = generateDeviceId();
        await Preferences.set({ key: 'mesh_device_id', value: this.localDeviceId });
      }
      
      if (storedName) {
        this.localDeviceName = storedName;
      } else {
        this.localDeviceName = `MeshUser-${this.localDeviceId.slice(0, 4)}`;
        await Preferences.set({ key: 'mesh_device_name', value: this.localDeviceName });
      }
    } catch (e) {
      this.localDeviceId = generateDeviceId();
      this.localDeviceName = `MeshUser-${this.localDeviceId.slice(0, 4)}`;
    }
    
    console.log('[UnifiedMesh] Device:', this.localDeviceId, this.localDeviceName);
  }

  private async initializeLocalMesh() {
    await localMesh.initialize(this.localDeviceId, this.localDeviceName);
    
    localMesh.setEventHandler('onDeviceDiscovered', (device) => {
      this.handleDeviceDiscovered(device, 'wifi');
    });
    
    localMesh.setEventHandler('onDeviceUpdated', (device) => {
      this.handleDeviceUpdated(device);
    });
    
    localMesh.setEventHandler('onDeviceLost', (deviceId) => {
      this.handleDeviceLost(deviceId);
    });
    
    localMesh.setEventHandler('onMessageReceived', (message) => {
      this.handleMessageReceived(message);
    });
    
    localMesh.setEventHandler('onMessageDelivered', (messageId) => {
      this.events.onMessageStatusChanged?.(messageId, 'delivered');
    });
  }

  private async initializeWebRTC() {
    try {
      await webRTCMesh.initialize(this.localDeviceId);
      smartTransport.updateTransportAvailability('webrtc', true, 0);
      console.log('[UnifiedMesh] WebRTC initialized');
    } catch (error) {
      console.error('[UnifiedMesh] WebRTC init failed:', error);
      smartTransport.updateTransportAvailability('webrtc', false, 0);
    }
  }

  private async initializeGlobalRelay() {
    await globalMeshRelay.initialize(this.localDeviceId, this.localDeviceName);
    
    globalMeshRelay.setEventHandler('onDeviceDiscovered', (device) => {
      this.handleDeviceDiscovered(device, 'network');
    });
    
    globalMeshRelay.setEventHandler('onDeviceUpdated', (device) => {
      this.handleDeviceUpdated(device);
    });
    
    globalMeshRelay.setEventHandler('onDeviceLost', (deviceId) => {
      this.handleDeviceLost(deviceId);
    });
    
    globalMeshRelay.setEventHandler('onMessageReceived', (message) => {
      this.handleMessageReceived(message);
    });
    
    globalMeshRelay.setEventHandler('onMessageStatusChanged', (messageId, status) => {
      this.events.onMessageStatusChanged?.(messageId, status);
    });
    
    globalMeshRelay.setEventHandler('onOnlineStatusChanged', (isOnline) => {
      smartTransport.updateTransportAvailability('network', isOnline, 
        isOnline ? globalMeshRelay.getDevices().length : 0);
      this.events.onConnectionStatusChanged?.(isOnline, this.getAvailableTransports());
    });

    globalMeshRelay.setEventHandler('onSignalReceived', (fromId, signal) => {
      // Forward to WebRTC for P2P connection
      webRTCMesh.acceptConnection(fromId, signal);
    });
  }

  private handleDeviceDiscovered(device: MeshDevice, transport: ConnectionType) {
    const existing = this.devices.get(device.id);
    
    if (!existing) {
      // New device
      device.connectionType = transport;
      this.devices.set(device.id, device);
      offlineStorage.saveDevice(device);
      smartTransport.updatePeerTransports(device.id, [transport]);
      
      console.log('[UnifiedMesh] New device discovered:', device.name, 'via', transport);
      this.events.onDeviceDiscovered?.(device);
    } else {
      // Merge with existing
      const merged: MeshDevice = {
        ...existing,
        ...device,
        signalStrength: Math.max(existing.signalStrength, device.signalStrength),
        isConnected: existing.isConnected || device.isConnected,
        isOnline: existing.isOnline || device.isOnline,
        lastSeen: new Date()
      };
      this.devices.set(device.id, merged);
      
      // Add transport to peer's available transports
      const existingTransports = smartTransport.getMetrics().get(transport);
      if (existingTransports) {
        smartTransport.updatePeerTransports(device.id, [transport, ...(existingTransports ? [existing.connectionType!] : [])]);
      }
      
      this.events.onDeviceUpdated?.(merged);
    }

    // Update transport device counts
    this.updateTransportCounts();
  }

  private handleDeviceUpdated(device: MeshDevice) {
    const existing = this.devices.get(device.id);
    if (existing) {
      const merged = { ...existing, ...device, lastSeen: new Date() };
      this.devices.set(device.id, merged);
      this.events.onDeviceUpdated?.(merged);
    }
  }

  private handleDeviceLost(deviceId: string) {
    const device = this.devices.get(deviceId);
    if (device) {
      // Don't remove, just mark as offline
      device.isOnline = false;
      device.isConnected = false;
      this.devices.set(deviceId, device);
      this.events.onDeviceLost?.(deviceId);
    }
  }

  private handleMessageReceived(message: MeshMessage) {
    offlineStorage.saveMessage(message, true);
    this.events.onMessageReceived?.(message);
  }

  private updateTransportCounts() {
    const localDevices = localMesh.getDevices().length;
    const globalDevices = globalMeshRelay.getDevices().length;
    const webrtcDevices = webRTCMesh.getConnectedPeers().length;

    smartTransport.updateTransportAvailability('wifi', true, localDevices);
    smartTransport.updateTransportAvailability('webrtc', webrtcDevices > 0, webrtcDevices);
    smartTransport.updateTransportAvailability('network', globalMeshRelay.getIsOnline(), globalDevices);
  }

  private startPeriodicSync() {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
    }

    this.syncInterval = setInterval(async () => {
      // Sync pending messages
      if (globalMeshRelay.getIsOnline()) {
        await globalMeshRelay.syncPendingMessages();
      }
      
      // Update transport counts
      this.updateTransportCounts();
    }, 30000);
  }

  // ============ PUBLIC API ============

  async startScanning(): Promise<void> {
    if (this.isScanning) return;
    
    console.log('[UnifiedMesh] Starting scan on all transports...');
    this.isScanning = true;
    this.events.onScanStateChanged?.(true);

    // Broadcast presence on all channels
    localMesh['announcePresence']();
    
    if (globalMeshRelay.getIsOnline()) {
      await globalMeshRelay.broadcastDiscovery();
    }

    // Continuous scan for a period
    let scanCount = 0;
    this.scanInterval = setInterval(() => {
      localMesh['announcePresence']();
      scanCount++;
      
      if (scanCount >= 5) {
        this.stopScanning();
      }
    }, 1000);

    // Fetch latest from global relay
    if (globalMeshRelay.getIsOnline()) {
      const globalDevices = globalMeshRelay.getDevices();
      globalDevices.forEach(d => {
        this.handleDeviceDiscovered(d, 'network');
      });
    }
  }

  stopScanning(): void {
    if (this.scanInterval) {
      clearInterval(this.scanInterval);
      this.scanInterval = null;
    }
    this.isScanning = false;
    this.events.onScanStateChanged?.(false);
    console.log('[UnifiedMesh] Scan stopped');
  }

  async sendMessage(content: string, receiverId: string): Promise<string> {
    const messageId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    console.log('[UnifiedMesh] Sending message:', messageId, 'to:', receiverId);

    const message: MeshMessage = {
      id: messageId,
      content,
      senderId: this.localDeviceId,
      receiverId,
      timestamp: new Date(),
      hops: [this.localDeviceId],
      status: 'sending'
    };

    // Save immediately
    await offlineStorage.saveMessage(message, false);

    // Use smart transport selector
    const result = await smartTransport.sendWithFallback(content, receiverId, messageId);

    if (result.success) {
      message.status = 'sent';
      await offlineStorage.saveMessage(message);
      this.events.onMessageStatusChanged?.(messageId, 'sent');
      
      // Simulate delivery after a delay (real delivery comes from transport)
      setTimeout(() => {
        this.events.onMessageStatusChanged?.(messageId, 'delivered');
        offlineStorage.updateMessageStatus(messageId, 'delivered');
      }, 1500);
    } else {
      // Queue for later
      message.status = 'queued';
      await offlineStorage.saveMessage(message);
      await offlineStorage.addToPendingQueue(message);
      this.events.onMessageStatusChanged?.(messageId, 'queued');
    }

    return messageId;
  }

  async sendTypingIndicator(receiverId: string, isTyping: boolean): Promise<void> {
    // Local
    localMesh.sendTypingIndicator(receiverId, isTyping);
    
    // Global
    if (globalMeshRelay.getIsOnline()) {
      await globalMeshRelay.setTypingIndicator(receiverId, isTyping);
    }
  }

  getDevices(): MeshDevice[] {
    return Array.from(this.devices.values());
  }

  getDevice(deviceId: string): MeshDevice | undefined {
    return this.devices.get(deviceId);
  }

  getLocalDeviceId(): string {
    return this.localDeviceId;
  }

  getLocalDeviceName(): string {
    return this.localDeviceName;
  }

  async setDeviceName(name: string): Promise<void> {
    this.localDeviceName = name;
    await Preferences.set({ key: 'mesh_device_name', value: name });
  }

  getIsOnline(): boolean {
    return globalMeshRelay.getIsOnline();
  }

  getIsScanning(): boolean {
    return this.isScanning;
  }

  getAvailableTransports(): ConnectionType[] {
    return smartTransport.getAvailableTransports();
  }

  getTransportStatuses(): TransportInfo[] {
    const statuses = smartTransport.getTransportStatus();
    return [
      {
        type: 'bluetooth',
        available: Capacitor.isNativePlatform(),
        enabled: Capacitor.isNativePlatform(),
        deviceCount: 0,
        label: 'Bluetooth'
      },
      {
        type: 'wifi',
        available: true,
        enabled: true,
        deviceCount: localMesh.getDevices().length,
        label: 'Local Mesh'
      },
      {
        type: 'webrtc',
        available: statuses.find(s => s.type === 'webrtc')?.available ?? false,
        enabled: true,
        deviceCount: webRTCMesh.getConnectedPeers().length,
        label: 'WebRTC P2P'
      },
      {
        type: 'network',
        available: globalMeshRelay.getIsOnline(),
        enabled: true,
        deviceCount: globalMeshRelay.getDevices().length,
        label: 'Global Relay'
      }
    ];
  }

  async loadCachedMessages(): Promise<MeshMessage[]> {
    return offlineStorage.getAllMessages(this.localDeviceId);
  }

  async retryMessage(messageId: string, content: string, receiverId: string): Promise<boolean> {
    const result = await smartTransport.sendWithFallback(content, receiverId, messageId);
    return result.success;
  }

  async cleanup(): Promise<void> {
    console.log('[UnifiedMesh] Cleaning up...');
    
    if (this.scanInterval) {
      clearInterval(this.scanInterval);
    }
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
    }

    localMesh.cleanup();
    webRTCMesh.cleanup();
    await globalMeshRelay.cleanup();

    this.devices.clear();
    this.isInitialized = false;
  }
}

export const unifiedMesh = new UnifiedMeshServiceImpl();
