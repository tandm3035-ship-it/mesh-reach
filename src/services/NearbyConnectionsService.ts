// Nearby Connections Service
// Uses Google Nearby Connections API for discovering and connecting to nearby devices
// Works over Bluetooth, BLE, and WiFi automatically

import { MeshDevice, ConnectionType } from '@/types/mesh';
import { multiTransportMesh, PeerInfo } from './MultiTransportMesh';
import { MeshPacket, decodePacket, encodePacket, createPacket, MESH_NAME_PREFIX } from './MeshProtocol';
import { Capacitor } from '@capacitor/core';

// Nearby Connections types (from capacitor-trancee-nearby-connections)
interface NearbyPlugin {
  startAdvertising(options: { name: string; serviceId: string; strategy: string }): Promise<void>;
  startDiscovery(options: { serviceId: string; strategy: string }): Promise<void>;
  stopAdvertising(): Promise<void>;
  stopDiscovery(): Promise<void>;
  acceptConnection(options: { endpointId: string }): Promise<void>;
  rejectConnection(options: { endpointId: string }): Promise<void>;
  sendPayload(options: { endpointIds: string[]; payload: string }): Promise<void>;
  disconnect(options: { endpointId: string }): Promise<void>;
  disconnectFromAllEndpoints(): Promise<void>;
  addListener(event: string, callback: (data: any) => void): Promise<{ remove: () => void }>;
}

// Service ID for mesh network
const SERVICE_ID = 'com.meshapp.nearby';
const STRATEGY = 'P2P_CLUSTER'; // Allows multiple connections

interface EndpointInfo {
  endpointId: string;
  endpointName: string;
  isConnected: boolean;
  lastSeen: number;
}

/**
 * Nearby Connections Service
 * Uses Google Nearby Connections (or compatible plugin) for mesh networking
 * Automatically selects best available medium (BLE, Bluetooth Classic, WiFi Direct)
 */
export class NearbyConnectionsService {
  private nearby: NearbyPlugin | null = null;
  private localName: string = '';
  private localId: string = '';
  private endpoints: Map<string, EndpointInfo> = new Map();
  private isAdvertising: boolean = false;
  private isDiscovering: boolean = false;
  private listenerRemovers: (() => void)[] = [];

  public async initialize(localDeviceId: string, localDeviceName: string): Promise<boolean> {
    if (!Capacitor.isNativePlatform()) {
      console.log('Nearby Connections not available on web');
      return false;
    }

    this.localId = localDeviceId;
    this.localName = localDeviceName;

    try {
      // Try to load the plugin dynamically - will be available after native build
      // @ts-ignore - Plugin loaded at runtime on native
      const NearbyConnections = (window as any).Capacitor?.Plugins?.NearbyConnections;
      if (!NearbyConnections) {
        throw new Error('NearbyConnections plugin not available');
      }
      this.nearby = NearbyConnections as NearbyPlugin;

      // Set up event listeners
      await this.setupListeners();

      multiTransportMesh.updateTransportStatus('wifi-direct', { available: true, enabled: true });
      return true;
    } catch (error) {
      console.log('Nearby Connections plugin not available:', error);
      multiTransportMesh.updateTransportStatus('wifi-direct', { available: false, error: String(error) });
      return false;
    }
  }

  private async setupListeners(): Promise<void> {
    if (!this.nearby) return;

    // Endpoint found
    const onFound = await this.nearby.addListener('onEndpointFound', (data) => {
      console.log('Endpoint found:', data);
      const { endpointId, endpointInfo } = data;
      
      this.endpoints.set(endpointId, {
        endpointId,
        endpointName: endpointInfo?.endpointName || `Nearby-${endpointId.slice(0, 4)}`,
        isConnected: false,
        lastSeen: Date.now()
      });

      // Add as discovered device
      const device: MeshDevice = {
        id: endpointId,
        name: endpointInfo?.endpointName || `Nearby-${endpointId.slice(0, 4)}`,
        signalStrength: 75,
        distance: 5,
        angle: Math.random() * 360,
        isConnected: false,
        lastSeen: new Date(),
        type: 'phone',
        connectionType: 'wifi',
        bluetoothEnabled: true
      };
      multiTransportMesh.addDiscoveredDevice(device);

      // Auto-accept connection
      this.nearby?.acceptConnection({ endpointId });
    });
    this.listenerRemovers.push(onFound.remove);

    // Endpoint lost
    const onLost = await this.nearby.addListener('onEndpointLost', (data) => {
      console.log('Endpoint lost:', data);
      const { endpointId } = data;
      this.endpoints.delete(endpointId);
      multiTransportMesh.removePeer(endpointId);
    });
    this.listenerRemovers.push(onLost.remove);

    // Connection initiated
    const onInit = await this.nearby.addListener('onConnectionInitiated', (data) => {
      console.log('Connection initiated:', data);
      const { endpointId, connectionInfo } = data;
      
      // Auto-accept
      this.nearby?.acceptConnection({ endpointId });
    });
    this.listenerRemovers.push(onInit.remove);

    // Connection result
    const onResult = await this.nearby.addListener('onConnectionResult', (data) => {
      console.log('Connection result:', data);
      const { endpointId, status } = data;
      
      if (status === 'STATUS_OK' || status.statusCode === 0) {
        const endpoint = this.endpoints.get(endpointId);
        if (endpoint) {
          endpoint.isConnected = true;
          
          // Register with mesh core
          const peerInfo: PeerInfo = {
            id: endpointId,
            name: endpoint.endpointName,
            transport: 'wifi-direct',
            lastSeen: Date.now(),
            connection: {
              send: async (data: Uint8Array) => {
                await this.sendToEndpoint(endpointId, data);
              }
            }
          };
          multiTransportMesh.addPeer(peerInfo);

          // Update device status
          const device = multiTransportMesh.getDevice(endpointId);
          if (device) {
            multiTransportMesh.addDiscoveredDevice({ ...device, isConnected: true });
          }

          // Announce presence
          multiTransportMesh.announcePresence();
        }
      }
    });
    this.listenerRemovers.push(onResult.remove);

    // Disconnected
    const onDisconnect = await this.nearby.addListener('onDisconnected', (data) => {
      console.log('Disconnected:', data);
      const { endpointId } = data;
      const endpoint = this.endpoints.get(endpointId);
      if (endpoint) {
        endpoint.isConnected = false;
      }
      multiTransportMesh.removePeer(endpointId);
    });
    this.listenerRemovers.push(onDisconnect.remove);

    // Payload received
    const onPayload = await this.nearby.addListener('onPayloadReceived', (data) => {
      console.log('Payload received:', data);
      const { endpointId, payload } = data;
      
      try {
        // Decode the payload (base64 or raw bytes)
        let bytes: Uint8Array;
        if (typeof payload === 'string') {
          bytes = Uint8Array.from(atob(payload), c => c.charCodeAt(0));
        } else if (payload.bytes) {
          bytes = new Uint8Array(payload.bytes);
        } else {
          return;
        }

        const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
        const packet = decodePacket(buffer);
        if (packet) {
          multiTransportMesh.handleReceivedPacket(packet, 'wifi-direct');
        }
      } catch (e) {
        console.log('Failed to process nearby payload:', e);
      }
    });
    this.listenerRemovers.push(onPayload.remove);
  }

  public async startAdvertising(): Promise<void> {
    if (!this.nearby || this.isAdvertising) return;

    try {
      await this.nearby.startAdvertising({
        name: this.localName,
        serviceId: SERVICE_ID,
        strategy: STRATEGY
      });
      this.isAdvertising = true;
      console.log('Started advertising');
    } catch (error) {
      console.error('Failed to start advertising:', error);
    }
  }

  public async startDiscovery(): Promise<void> {
    if (!this.nearby || this.isDiscovering) return;

    try {
      await this.nearby.startDiscovery({
        serviceId: SERVICE_ID,
        strategy: STRATEGY
      });
      this.isDiscovering = true;
      console.log('Started discovery');
    } catch (error) {
      console.error('Failed to start discovery:', error);
    }
  }

  public async stopAdvertising(): Promise<void> {
    if (!this.nearby || !this.isAdvertising) return;

    try {
      await this.nearby.stopAdvertising();
      this.isAdvertising = false;
    } catch (error) {
      console.error('Failed to stop advertising:', error);
    }
  }

  public async stopDiscovery(): Promise<void> {
    if (!this.nearby || !this.isDiscovering) return;

    try {
      await this.nearby.stopDiscovery();
      this.isDiscovering = false;
    } catch (error) {
      console.error('Failed to stop discovery:', error);
    }
  }

  public async sendToEndpoint(endpointId: string, data: Uint8Array): Promise<void> {
    if (!this.nearby) return;

    try {
      // Convert to base64 for transmission
      const base64 = btoa(String.fromCharCode(...data));
      await this.nearby.sendPayload({
        endpointIds: [endpointId],
        payload: base64
      });
    } catch (error) {
      console.error('Failed to send payload:', error);
    }
  }

  public async broadcast(data: Uint8Array): Promise<void> {
    if (!this.nearby) return;

    const connectedEndpoints = Array.from(this.endpoints.values())
      .filter(e => e.isConnected)
      .map(e => e.endpointId);

    if (connectedEndpoints.length === 0) return;

    try {
      const base64 = btoa(String.fromCharCode(...data));
      await this.nearby.sendPayload({
        endpointIds: connectedEndpoints,
        payload: base64
      });
    } catch (error) {
      console.error('Failed to broadcast:', error);
    }
  }

  public getConnectedEndpoints(): string[] {
    return Array.from(this.endpoints.values())
      .filter(e => e.isConnected)
      .map(e => e.endpointId);
  }

  public async cleanup(): Promise<void> {
    // Remove listeners
    this.listenerRemovers.forEach(remove => {
      try { remove(); } catch (e) { /* ignore */ }
    });
    this.listenerRemovers = [];

    if (this.nearby) {
      try {
        await this.stopAdvertising();
        await this.stopDiscovery();
        await this.nearby.disconnectFromAllEndpoints();
      } catch (e) {
        console.log('Cleanup error:', e);
      }
    }

    this.endpoints.clear();
  }
}

export const nearbyConnections = new NearbyConnectionsService();
