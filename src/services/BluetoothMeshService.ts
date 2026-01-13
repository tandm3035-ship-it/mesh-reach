import { BleClient, BleDevice, ScanResult } from '@capacitor-community/bluetooth-le';
import { Preferences } from '@capacitor/preferences';
import { 
  MeshPacket, 
  MESH_SERVICE_UUID, 
  MESH_CHARACTERISTIC_UUID, 
  MESH_NAME_PREFIX,
  createPacket,
  encodePacket,
  decodePacket,
  verifyPacket,
  shouldRelay,
  prepareForRelay,
  generateDeviceId
} from './MeshProtocol';
import { MeshDevice, MeshMessage } from '@/types/mesh';

export interface BluetoothMeshEvents {
  onDeviceDiscovered: (device: MeshDevice) => void;
  onDeviceUpdated: (device: MeshDevice) => void;
  onDeviceLost: (deviceId: string) => void;
  onMessageReceived: (message: MeshMessage) => void;
  onMessageStatusChanged: (messageId: string, status: MeshMessage['status']) => void;
  onScanStateChanged: (isScanning: boolean) => void;
  onConnectionStatusChanged: (isConnected: boolean) => void;
  onError: (error: string) => void;
}

export class BluetoothMeshService {
  private localDeviceId: string = '';
  private localDeviceName: string = '';
  private isInitialized: boolean = false;
  private isScanning: boolean = false;
  private connectedDevices: Map<string, BleDevice> = new Map();
  private discoveredDevices: Map<string, MeshDevice> = new Map();
  private messageQueue: Map<string, MeshPacket> = new Map();
  private processedPackets: Set<string> = new Set();
  private retryTimers: Map<string, NodeJS.Timeout> = new Map();
  private events: Partial<BluetoothMeshEvents> = {};
  private scanTimeout: NodeJS.Timeout | null = null;
  private heartbeatInterval: NodeJS.Timeout | null = null;

  constructor() {
    this.loadDeviceId();
  }

  private async loadDeviceId() {
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

  public async setDeviceName(name: string) {
    this.localDeviceName = name;
    await Preferences.set({ key: 'mesh_device_name', value: name });
  }

  public setEventHandler<K extends keyof BluetoothMeshEvents>(
    event: K, 
    handler: BluetoothMeshEvents[K]
  ) {
    this.events[event] = handler;
  }

  public async initialize(): Promise<boolean> {
    try {
      await BleClient.initialize({ androidNeverForLocation: true });
      this.isInitialized = true;
      
      // Start heartbeat to maintain connections
      this.startHeartbeat();
      
      return true;
    } catch (error) {
      console.error('Failed to initialize Bluetooth:', error);
      this.events.onError?.(`Bluetooth initialization failed: ${error}`);
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
    }, 5000);
  }

  private async updateDeviceStatuses() {
    const now = Date.now();
    const timeout = 30000; // 30 seconds without seeing device
    
    for (const [id, device] of this.discoveredDevices) {
      const lastSeenTime = device.lastSeen.getTime();
      
      if (now - lastSeenTime > timeout) {
        // Mark device as disconnected
        const updatedDevice = { ...device, isConnected: false };
        this.discoveredDevices.set(id, updatedDevice);
        this.events.onDeviceUpdated?.(updatedDevice);
      }
      
      if (now - lastSeenTime > timeout * 3) {
        // Remove device if not seen for too long
        this.discoveredDevices.delete(id);
        this.connectedDevices.delete(id);
        this.events.onDeviceLost?.(id);
      }
    }
  }

  private async retryPendingMessages() {
    for (const [messageId, packet] of this.messageQueue) {
      // Try to send through any available connection
      await this.broadcastPacket(packet);
    }
  }

  public async startScan(): Promise<void> {
    if (!this.isInitialized) {
      await this.initialize();
    }

    if (this.isScanning) return;

    try {
      this.isScanning = true;
      this.events.onScanStateChanged?.(true);

      // Request Bluetooth permissions on Android
      await BleClient.requestLEScan(
        {
          services: [MESH_SERVICE_UUID],
          namePrefix: MESH_NAME_PREFIX,
          allowDuplicates: true
        },
        this.handleScanResult.bind(this)
      );

      // Also scan without service filter for compatibility
      await BleClient.requestLEScan(
        {
          namePrefix: MESH_NAME_PREFIX,
          allowDuplicates: true
        },
        this.handleScanResult.bind(this)
      );

      // Auto-stop after 30 seconds
      this.scanTimeout = setTimeout(() => {
        this.stopScan();
      }, 30000);

    } catch (error) {
      console.error('Scan failed:', error);
      this.isScanning = false;
      this.events.onScanStateChanged?.(false);
      this.events.onError?.(`Scan failed: ${error}`);
    }
  }

  private handleScanResult(result: ScanResult) {
    const { device, rssi, localName } = result;
    
    // Calculate approximate distance from RSSI
    const txPower = -59; // Typical BLE TX power at 1 meter
    const distance = Math.pow(10, (txPower - (rssi || -100)) / (10 * 2));
    
    // Calculate signal strength percentage (0-100)
    const signalStrength = Math.max(0, Math.min(100, ((rssi || -100) + 100) * 2));
    
    // Parse device type from name or guess
    let deviceType: MeshDevice['type'] = 'unknown';
    const name = localName || device.name || `Device-${device.deviceId.slice(-4)}`;
    
    if (name.toLowerCase().includes('phone') || name.toLowerCase().includes('iphone')) {
      deviceType = 'phone';
    } else if (name.toLowerCase().includes('ipad') || name.toLowerCase().includes('tab')) {
      deviceType = 'tablet';
    } else if (name.toLowerCase().includes('mac') || name.toLowerCase().includes('laptop')) {
      deviceType = 'laptop';
    }

    // Generate consistent angle based on device ID
    const angle = (parseInt(device.deviceId.replace(/[^0-9]/g, '').slice(-3) || '0') * 137.5) % 360;

    const meshDevice: MeshDevice = {
      id: device.deviceId,
      name,
      signalStrength,
      distance: Math.round(distance * 10) / 10,
      angle,
      isConnected: false,
      lastSeen: new Date(),
      type: deviceType,
      connectionType: 'bluetooth'
    };

    const existing = this.discoveredDevices.get(device.deviceId);
    
    if (existing) {
      // Update existing device
      const updated = {
        ...existing,
        ...meshDevice,
        isConnected: existing.isConnected
      };
      this.discoveredDevices.set(device.deviceId, updated);
      this.events.onDeviceUpdated?.(updated);
    } else {
      // New device discovered
      this.discoveredDevices.set(device.deviceId, meshDevice);
      this.events.onDeviceDiscovered?.(meshDevice);
      
      // Try to connect automatically
      this.connectToDevice(device.deviceId);
    }
  }

  public async stopScan(): Promise<void> {
    try {
      await BleClient.stopLEScan();
    } catch (e) {
      console.log('Stop scan error (may be already stopped):', e);
    }
    
    this.isScanning = false;
    this.events.onScanStateChanged?.(false);
    
    if (this.scanTimeout) {
      clearTimeout(this.scanTimeout);
      this.scanTimeout = null;
    }
  }

  public async connectToDevice(deviceId: string): Promise<boolean> {
    try {
      await BleClient.connect(deviceId, (disconnectedId) => {
        // Handle disconnect
        const device = this.discoveredDevices.get(disconnectedId);
        if (device) {
          const updated = { ...device, isConnected: false };
          this.discoveredDevices.set(disconnectedId, updated);
          this.events.onDeviceUpdated?.(updated);
        }
        this.connectedDevices.delete(disconnectedId);
      });

      // Update device status
      const device = this.discoveredDevices.get(deviceId);
      if (device) {
        const updated = { ...device, isConnected: true, lastSeen: new Date() };
        this.discoveredDevices.set(deviceId, updated);
        this.events.onDeviceUpdated?.(updated);
      }

      this.connectedDevices.set(deviceId, { deviceId });
      
      // Start listening for messages from this device
      await this.startNotifications(deviceId);
      
      return true;
    } catch (error) {
      console.log('Connection failed:', error);
      return false;
    }
  }

  private async startNotifications(deviceId: string) {
    try {
      await BleClient.startNotifications(
        deviceId,
        MESH_SERVICE_UUID,
        MESH_CHARACTERISTIC_UUID,
        (value) => {
          const buffer = value.buffer instanceof ArrayBuffer ? value.buffer : new ArrayBuffer(0);
          this.handleReceivedData(deviceId, buffer);
        }
      );
    } catch (e) {
      console.log('Could not start notifications:', e);
    }
  }

  private handleReceivedData(fromDeviceId: string, data: ArrayBuffer) {
    const packet = decodePacket(data);
    if (!packet) return;
    
    // Verify packet integrity
    if (!verifyPacket(packet)) {
      console.log('Invalid packet signature');
      return;
    }
    
    // Check if we've already processed this packet
    if (this.processedPackets.has(packet.id)) {
      return;
    }
    this.processedPackets.add(packet.id);
    
    // Clean up old processed packets (keep last 1000)
    if (this.processedPackets.size > 1000) {
      const arr = Array.from(this.processedPackets);
      this.processedPackets = new Set(arr.slice(-500));
    }

    switch (packet.type) {
      case 'MESSAGE':
        this.handleMessagePacket(packet, fromDeviceId);
        break;
      case 'ACK':
        this.handleAckPacket(packet);
        break;
      case 'DISCOVER':
      case 'ANNOUNCE':
        this.handleDiscoveryPacket(packet, fromDeviceId);
        break;
      case 'PING':
        this.handlePingPacket(packet, fromDeviceId);
        break;
    }

    // Relay if needed
    if (shouldRelay(packet, this.localDeviceId)) {
      const relayPacket = prepareForRelay(packet, this.localDeviceId);
      this.broadcastPacket(relayPacket);
    }
  }

  private handleMessagePacket(packet: MeshPacket, fromDeviceId: string) {
    if (packet.targetId === this.localDeviceId || packet.targetId === '*') {
      // Message is for us
      const message: MeshMessage = {
        id: packet.id,
        content: packet.payload,
        senderId: packet.originalSenderId,
        receiverId: this.localDeviceId,
        timestamp: new Date(packet.timestamp),
        hops: packet.hops,
        status: 'delivered'
      };
      
      this.events.onMessageReceived?.(message);
      
      // Send acknowledgment
      this.sendAck(packet);
    }
  }

  private handleAckPacket(packet: MeshPacket) {
    // Find the original message in our queue
    const originalId = packet.payload; // ACK payload contains original message ID
    
    if (this.messageQueue.has(originalId)) {
      this.messageQueue.delete(originalId);
      this.events.onMessageStatusChanged?.(originalId, 'delivered');
      
      // Clear retry timer
      const timer = this.retryTimers.get(originalId);
      if (timer) {
        clearTimeout(timer);
        this.retryTimers.delete(originalId);
      }
    }
  }

  private handleDiscoveryPacket(packet: MeshPacket, fromDeviceId: string) {
    // Update device info from discovery packet
    const deviceInfo = JSON.parse(packet.payload);
    const device = this.discoveredDevices.get(fromDeviceId);
    
    if (device) {
      const updated = {
        ...device,
        name: deviceInfo.name || device.name,
        lastSeen: new Date()
      };
      this.discoveredDevices.set(fromDeviceId, updated);
      this.events.onDeviceUpdated?.(updated);
    }
  }

  private handlePingPacket(packet: MeshPacket, fromDeviceId: string) {
    // Update last seen
    const device = this.discoveredDevices.get(fromDeviceId);
    if (device) {
      const updated = { ...device, lastSeen: new Date() };
      this.discoveredDevices.set(fromDeviceId, updated);
    }
  }

  private async sendAck(originalPacket: MeshPacket) {
    const ackPacket = createPacket(
      'ACK',
      this.localDeviceId,
      originalPacket.originalSenderId,
      originalPacket.id
    );
    
    await this.broadcastPacket(ackPacket);
  }

  public async sendMessage(content: string, receiverId: string): Promise<string> {
    const packet = createPacket(
      'MESSAGE',
      this.localDeviceId,
      receiverId,
      content
    );
    
    // Add to queue for retry
    this.messageQueue.set(packet.id, packet);
    
    // Set up retry mechanism
    let retryCount = 0;
    const maxRetries = 10;
    
    const scheduleRetry = () => {
      if (retryCount >= maxRetries) {
        this.messageQueue.delete(packet.id);
        this.events.onMessageStatusChanged?.(packet.id, 'failed');
        return;
      }
      
      retryCount++;
      const timer = setTimeout(async () => {
        if (this.messageQueue.has(packet.id)) {
          await this.broadcastPacket(packet);
          scheduleRetry();
        }
      }, Math.min(1000 * Math.pow(2, retryCount), 30000)); // Exponential backoff, max 30s
      
      this.retryTimers.set(packet.id, timer);
    };
    
    // Send immediately
    await this.broadcastPacket(packet);
    scheduleRetry();
    
    return packet.id;
  }

  private async broadcastPacket(packet: MeshPacket): Promise<void> {
    const buffer = encodePacket(packet);
    const data = new DataView(buffer instanceof ArrayBuffer ? buffer : new ArrayBuffer(0));
    
    // Send to all connected devices
    for (const [deviceId] of this.connectedDevices) {
      try {
        await BleClient.write(
          deviceId,
          MESH_SERVICE_UUID,
          MESH_CHARACTERISTIC_UUID,
          data
        );
      } catch (e) {
        console.log(`Failed to send to ${deviceId}:`, e);
      }
    }
  }

  public async announcePresence(): Promise<void> {
    const packet = createPacket(
      'ANNOUNCE',
      this.localDeviceId,
      '*',
      JSON.stringify({
        name: this.localDeviceName,
        capabilities: ['MESSAGE', 'RELAY']
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

  public async disconnect(): Promise<void> {
    // Stop scanning
    await this.stopScan();
    
    // Disconnect from all devices
    for (const [deviceId] of this.connectedDevices) {
      try {
        await BleClient.disconnect(deviceId);
      } catch (e) {
        console.log('Disconnect error:', e);
      }
    }
    
    this.connectedDevices.clear();
    
    // Clear heartbeat
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
    }
    
    // Clear all retry timers
    for (const timer of this.retryTimers.values()) {
      clearTimeout(timer);
    }
    this.retryTimers.clear();
  }
}

// Singleton instance
export const meshService = new BluetoothMeshService();
