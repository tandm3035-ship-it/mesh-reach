// Offline Storage Service - IndexedDB-based storage for mesh data
// Enables fully offline operation without any internet connection

import { MeshDevice, MeshMessage } from '@/types/mesh';

const DB_NAME = 'meshlink_offline_v3';
const DB_VERSION = 3;

interface StoredDevice extends MeshDevice {
  storedAt: number;
}

interface StoredMessage extends MeshMessage {
  storedAt: number;
  synced: boolean;
  conversationKey: string; // For efficient conversation lookups
}

interface PendingMessage {
  id: string;
  message: MeshMessage;
  retries: number;
  lastAttempt: number;
}

interface DeviceIdentity {
  deviceId: string;
  deviceName: string;
  createdAt: number;
}

class OfflineStorageService {
  private db: IDBDatabase | null = null;
  private isInitialized = false;

  async initialize(): Promise<boolean> {
    if (this.isInitialized && this.db) return true;

    return new Promise((resolve) => {
      try {
        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onerror = () => {
          console.error('[OfflineStorage] Failed to open database');
          resolve(false);
        };

        request.onsuccess = () => {
          this.db = request.result;
          this.isInitialized = true;
          console.log('[OfflineStorage] Database opened successfully');
          resolve(true);
        };

        request.onupgradeneeded = (event) => {
          const db = (event.target as IDBOpenDBRequest).result;

          // Devices store
          if (!db.objectStoreNames.contains('devices')) {
            const devicesStore = db.createObjectStore('devices', { keyPath: 'id' });
            devicesStore.createIndex('lastSeen', 'lastSeen', { unique: false });
            devicesStore.createIndex('isOnline', 'isOnline', { unique: false });
          }

          // Messages store with conversation key for efficient lookups
          if (!db.objectStoreNames.contains('messages')) {
            const messagesStore = db.createObjectStore('messages', { keyPath: 'id' });
            messagesStore.createIndex('senderId', 'senderId', { unique: false });
            messagesStore.createIndex('receiverId', 'receiverId', { unique: false });
            messagesStore.createIndex('timestamp', 'timestamp', { unique: false });
            messagesStore.createIndex('synced', 'synced', { unique: false });
            messagesStore.createIndex('conversationKey', 'conversationKey', { unique: false });
          }

          // Pending messages store (for retry queue)
          if (!db.objectStoreNames.contains('pendingMessages')) {
            const pendingStore = db.createObjectStore('pendingMessages', { keyPath: 'id' });
            pendingStore.createIndex('retries', 'retries', { unique: false });
          }

          // Local device config
          if (!db.objectStoreNames.contains('config')) {
            db.createObjectStore('config', { keyPath: 'key' });
          }

          // Device identity - persistent across sessions
          if (!db.objectStoreNames.contains('identity')) {
            db.createObjectStore('identity', { keyPath: 'key' });
          }

          console.log('[OfflineStorage] Database schema created');
        };
      } catch (e) {
        console.error('[OfflineStorage] IndexedDB not available:', e);
        resolve(false);
      }
    });
  }

  // ============ DEVICE IDENTITY ============
  
  async getDeviceIdentity(): Promise<DeviceIdentity | null> {
    if (!this.db) return null;

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['identity'], 'readonly');
      const store = transaction.objectStore('identity');
      const request = store.get('device_identity');

      request.onsuccess = () => {
        resolve(request.result?.value ?? null);
      };
      request.onerror = () => reject(request.error);
    });
  }

  async setDeviceIdentity(identity: DeviceIdentity): Promise<void> {
    if (!this.db) return;

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['identity'], 'readwrite');
      const store = transaction.objectStore('identity');
      const request = store.put({ key: 'device_identity', value: identity });

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  // ============ DEVICE OPERATIONS ============

  async saveDevice(device: MeshDevice): Promise<void> {
    if (!this.db) return;

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['devices'], 'readwrite');
      const store = transaction.objectStore('devices');

      const storedDevice: StoredDevice = {
        ...device,
        storedAt: Date.now(),
        lastSeen: device.lastSeen instanceof Date ? device.lastSeen : new Date(device.lastSeen)
      };

      const request = store.put(storedDevice);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  async getDevice(deviceId: string): Promise<MeshDevice | null> {
    if (!this.db) return null;

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['devices'], 'readonly');
      const store = transaction.objectStore('devices');
      const request = store.get(deviceId);

      request.onsuccess = () => {
        const result = request.result as StoredDevice | undefined;
        if (result) {
          resolve({
            ...result,
            lastSeen: new Date(result.lastSeen)
          });
        } else {
          resolve(null);
        }
      };
      request.onerror = () => reject(request.error);
    });
  }

  async getAllDevices(): Promise<MeshDevice[]> {
    if (!this.db) return [];

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['devices'], 'readonly');
      const store = transaction.objectStore('devices');
      const request = store.getAll();

      request.onsuccess = () => {
        const results = (request.result as StoredDevice[]).map(d => ({
          ...d,
          lastSeen: new Date(d.lastSeen)
        }));
        resolve(results);
      };
      request.onerror = () => reject(request.error);
    });
  }

  async deleteDevice(deviceId: string): Promise<void> {
    if (!this.db) return;

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['devices'], 'readwrite');
      const store = transaction.objectStore('devices');
      const request = store.delete(deviceId);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  // ============ MESSAGE OPERATIONS ============

  private getConversationKey(senderId: string, receiverId: string): string {
    // Create a consistent key regardless of sender/receiver order
    const sorted = [senderId, receiverId].sort();
    return `${sorted[0]}:${sorted[1]}`;
  }

  async saveMessage(message: MeshMessage, synced = false): Promise<void> {
    if (!this.db) return;

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['messages'], 'readwrite');
      const store = transaction.objectStore('messages');

      const storedMessage: StoredMessage = {
        ...message,
        storedAt: Date.now(),
        synced,
        timestamp: message.timestamp instanceof Date ? message.timestamp : new Date(message.timestamp),
        conversationKey: this.getConversationKey(message.senderId, message.receiverId)
      };

      const request = store.put(storedMessage);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  async getMessage(messageId: string): Promise<MeshMessage | null> {
    if (!this.db) return null;

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['messages'], 'readonly');
      const store = transaction.objectStore('messages');
      const request = store.get(messageId);

      request.onsuccess = () => {
        const result = request.result as StoredMessage | undefined;
        if (result) {
          resolve({
            ...result,
            timestamp: new Date(result.timestamp)
          });
        } else {
          resolve(null);
        }
      };
      request.onerror = () => reject(request.error);
    });
  }

  async getMessagesForConversation(deviceId1: string, deviceId2: string): Promise<MeshMessage[]> {
    if (!this.db) return [];

    const conversationKey = this.getConversationKey(deviceId1, deviceId2);

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['messages'], 'readonly');
      const store = transaction.objectStore('messages');
      const index = store.index('conversationKey');
      const request = index.getAll(IDBKeyRange.only(conversationKey));

      request.onsuccess = () => {
        const results = (request.result as StoredMessage[])
          .map(m => ({
            ...m,
            timestamp: new Date(m.timestamp)
          }))
          .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
        resolve(results);
      };
      request.onerror = () => reject(request.error);
    });
  }

  async getAllMessages(localDeviceId: string): Promise<MeshMessage[]> {
    if (!this.db) return [];

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['messages'], 'readonly');
      const store = transaction.objectStore('messages');
      const request = store.getAll();

      request.onsuccess = () => {
        const results = (request.result as StoredMessage[])
          .filter(m => m.senderId === localDeviceId || m.receiverId === localDeviceId)
          .map(m => ({
            ...m,
            timestamp: new Date(m.timestamp)
          }))
          .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
        resolve(results);
      };
      request.onerror = () => reject(request.error);
    });
  }

  async getUnsyncedMessages(): Promise<MeshMessage[]> {
    if (!this.db) return [];

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['messages'], 'readonly');
      const store = transaction.objectStore('messages');
      const index = store.index('synced');
      const request = index.getAll(IDBKeyRange.only(false));

      request.onsuccess = () => {
        const results = (request.result as StoredMessage[]).map(m => ({
          ...m,
          timestamp: new Date(m.timestamp)
        }));
        resolve(results);
      };
      request.onerror = () => reject(request.error);
    });
  }

  async markMessageSynced(messageId: string): Promise<void> {
    if (!this.db) return;

    const message = await this.getMessage(messageId);
    if (message) {
      await this.saveMessage(message, true);
    }
  }

  async updateMessageStatus(messageId: string, status: MeshMessage['status']): Promise<void> {
    if (!this.db) return;

    const message = await this.getMessage(messageId);
    if (message) {
      message.status = status;
      await this.saveMessage(message);
    }
  }

  async messageExists(messageId: string): Promise<boolean> {
    const message = await this.getMessage(messageId);
    return message !== null;
  }

  // ============ PENDING MESSAGE QUEUE ============

  async addToPendingQueue(message: MeshMessage): Promise<void> {
    if (!this.db) return;

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['pendingMessages'], 'readwrite');
      const store = transaction.objectStore('pendingMessages');

      const pending: PendingMessage = {
        id: message.id,
        message,
        retries: 0,
        lastAttempt: Date.now()
      };

      const request = store.put(pending);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  async getPendingMessages(): Promise<PendingMessage[]> {
    if (!this.db) return [];

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['pendingMessages'], 'readonly');
      const store = transaction.objectStore('pendingMessages');
      const request = store.getAll();

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async updatePendingRetry(messageId: string): Promise<void> {
    if (!this.db) return;

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['pendingMessages'], 'readwrite');
      const store = transaction.objectStore('pendingMessages');
      const request = store.get(messageId);

      request.onsuccess = () => {
        const pending = request.result as PendingMessage;
        if (pending) {
          pending.retries++;
          pending.lastAttempt = Date.now();
          store.put(pending);
        }
        resolve();
      };
      request.onerror = () => reject(request.error);
    });
  }

  async removeFromPendingQueue(messageId: string): Promise<void> {
    if (!this.db) return;

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['pendingMessages'], 'readwrite');
      const store = transaction.objectStore('pendingMessages');
      const request = store.delete(messageId);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  // ============ CONFIG OPERATIONS ============

  async setConfig(key: string, value: any): Promise<void> {
    if (!this.db) return;

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['config'], 'readwrite');
      const store = transaction.objectStore('config');
      const request = store.put({ key, value, updatedAt: Date.now() });

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  async getConfig(key: string): Promise<any> {
    if (!this.db) return null;

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['config'], 'readonly');
      const store = transaction.objectStore('config');
      const request = store.get(key);

      request.onsuccess = () => {
        resolve(request.result?.value ?? null);
      };
      request.onerror = () => reject(request.error);
    });
  }

  // ============ CLEANUP ============

  async cleanupOldData(maxAge: number = 7 * 24 * 60 * 60 * 1000): Promise<void> {
    if (!this.db) return;

    const cutoff = Date.now() - maxAge;

    // Clean old devices
    const devices = await this.getAllDevices();
    for (const device of devices) {
      if (device.lastSeen.getTime() < cutoff && !device.isSelf) {
        await this.deleteDevice(device.id);
      }
    }

    console.log('[OfflineStorage] Cleanup completed');
  }

  // Clear all data (for debugging)
  async clearAllData(): Promise<void> {
    if (!this.db) return;

    const stores = ['devices', 'messages', 'pendingMessages', 'config'];
    
    for (const storeName of stores) {
      await new Promise<void>((resolve, reject) => {
        const transaction = this.db!.transaction([storeName], 'readwrite');
        const store = transaction.objectStore(storeName);
        const request = store.clear();
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      });
    }

    console.log('[OfflineStorage] All data cleared');
  }
}

export const offlineStorage = new OfflineStorageService();