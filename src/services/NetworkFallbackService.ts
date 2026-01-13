import { Network, ConnectionStatus } from '@capacitor/network';
import { Preferences } from '@capacitor/preferences';
import { MeshDevice, MeshMessage } from '@/types/mesh';

export type ConnectionMethod = 'bluetooth' | 'wifi' | 'network' | 'offline';

export interface NetworkStatusInfo {
  isConnected: boolean;
  connectionType: ConnectionMethod;
  bluetoothAvailable: boolean;
  wifiAvailable: boolean;
  internetAvailable: boolean;
}

export interface NetworkFallbackEvents {
  onStatusChanged: (status: NetworkStatusInfo) => void;
  onMethodChanged: (method: ConnectionMethod) => void;
}

/**
 * NetworkFallbackService handles connection method detection and fallback
 * When Bluetooth is unavailable, it tries WiFi Direct or network-based P2P
 */
export class NetworkFallbackService {
  private currentStatus: NetworkStatusInfo = {
    isConnected: false,
    connectionType: 'offline',
    bluetoothAvailable: false,
    wifiAvailable: false,
    internetAvailable: false
  };
  
  private events: Partial<NetworkFallbackEvents> = {};
  private statusCheckInterval: NodeJS.Timeout | null = null;

  public setEventHandler<K extends keyof NetworkFallbackEvents>(
    event: K,
    handler: NetworkFallbackEvents[K]
  ) {
    this.events[event] = handler;
  }

  public async initialize(): Promise<NetworkStatusInfo> {
    // Get initial network status
    const status = await Network.getStatus();
    this.updateFromNetworkStatus(status);
    
    // Listen for network changes
    Network.addListener('networkStatusChange', (status) => {
      this.updateFromNetworkStatus(status);
    });
    
    // Periodically check status
    this.statusCheckInterval = setInterval(() => {
      this.checkAllConnections();
    }, 10000);
    
    return this.currentStatus;
  }

  private updateFromNetworkStatus(status: ConnectionStatus) {
    const isWifi = status.connectionType === 'wifi';
    const isCellular = status.connectionType === 'cellular';
    
    this.currentStatus = {
      ...this.currentStatus,
      internetAvailable: status.connected,
      wifiAvailable: isWifi,
      isConnected: status.connected || this.currentStatus.bluetoothAvailable
    };
    
    // Determine best connection method
    if (this.currentStatus.bluetoothAvailable) {
      this.currentStatus.connectionType = 'bluetooth';
    } else if (isWifi) {
      this.currentStatus.connectionType = 'wifi';
    } else if (isCellular || status.connected) {
      this.currentStatus.connectionType = 'network';
    } else {
      this.currentStatus.connectionType = 'offline';
    }
    
    this.events.onStatusChanged?.(this.currentStatus);
    this.events.onMethodChanged?.(this.currentStatus.connectionType);
  }

  public setBluetoothAvailable(available: boolean) {
    if (this.currentStatus.bluetoothAvailable !== available) {
      this.currentStatus.bluetoothAvailable = available;
      
      // Re-evaluate connection type
      if (available) {
        this.currentStatus.connectionType = 'bluetooth';
      } else if (this.currentStatus.wifiAvailable) {
        this.currentStatus.connectionType = 'wifi';
      } else if (this.currentStatus.internetAvailable) {
        this.currentStatus.connectionType = 'network';
      } else {
        this.currentStatus.connectionType = 'offline';
      }
      
      this.currentStatus.isConnected = 
        available || 
        this.currentStatus.wifiAvailable || 
        this.currentStatus.internetAvailable;
      
      this.events.onStatusChanged?.(this.currentStatus);
      this.events.onMethodChanged?.(this.currentStatus.connectionType);
    }
  }

  private async checkAllConnections() {
    const networkStatus = await Network.getStatus();
    this.updateFromNetworkStatus(networkStatus);
  }

  public getCurrentStatus(): NetworkStatusInfo {
    return { ...this.currentStatus };
  }

  public getBestConnectionMethod(): ConnectionMethod {
    return this.currentStatus.connectionType;
  }

  public async cleanup() {
    if (this.statusCheckInterval) {
      clearInterval(this.statusCheckInterval);
    }
    await Network.removeAllListeners();
  }
}

// Queue messages when offline and retry when online
export class OfflineMessageQueue {
  private queue: Map<string, { message: MeshMessage; retries: number; maxRetries: number }> = new Map();
  private storageKey = 'offline_message_queue';

  async load() {
    try {
      const { value } = await Preferences.get({ key: this.storageKey });
      if (value) {
        const data = JSON.parse(value);
        for (const item of data) {
          this.queue.set(item.message.id, item);
        }
      }
    } catch (e) {
      console.log('Failed to load offline queue:', e);
    }
  }

  async save() {
    try {
      const data = Array.from(this.queue.values());
      await Preferences.set({ 
        key: this.storageKey, 
        value: JSON.stringify(data) 
      });
    } catch (e) {
      console.log('Failed to save offline queue:', e);
    }
  }

  add(message: MeshMessage, maxRetries: number = 10) {
    this.queue.set(message.id, { message, retries: 0, maxRetries });
    this.save();
  }

  remove(messageId: string) {
    this.queue.delete(messageId);
    this.save();
  }

  getAll(): MeshMessage[] {
    return Array.from(this.queue.values()).map(item => item.message);
  }

  incrementRetry(messageId: string): boolean {
    const item = this.queue.get(messageId);
    if (!item) return false;
    
    item.retries++;
    if (item.retries >= item.maxRetries) {
      this.queue.delete(messageId);
      this.save();
      return false; // No more retries
    }
    
    this.save();
    return true; // Can retry
  }
}

export const networkFallback = new NetworkFallbackService();
export const offlineQueue = new OfflineMessageQueue();
