// Offline Storage Service - IndexedDB-based storage for mesh data
// Enables fully offline operation without any internet connection

import { MeshDevice, MeshMessage } from '@/types/mesh';

const DB_NAME = 'meshlink_offline';
const DB_VERSION = 2;

interface StoredDevice extends MeshDevice {
  storedAt: number;
}

interface StoredMessage extends MeshMessage {
  storedAt: number;
  synced: boolean;
}

interface PendingMessage {
  id: string;
  message: MeshMessage;
  retries: number;
  lastAttempt: number;
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

          // Messages store
          if (!db.objectStoreNames.contains('messages')) {
            const messagesStore = db.createObjectStore('messages', { keyPath: 'id' });
            messagesStore.createIndex('senderId', 'senderId', { unique: false });
            messagesStore.createIndex('receiverId', 'receiverId', { unique: false });
            messagesStore.createIndex('timestamp', 'timestamp', { unique: false });
            messagesStore.createIndex('synced', 'synced', { unique: false });
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

          console.log('[OfflineStorage] Database schema created');
        };
      } catch (e) {
        console.error('[OfflineStorage] IndexedDB not available:', e);
        resolve(false);
      }
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

  async saveMessage(message: MeshMessage, synced = false): Promise<void> {
    if (!this.db) return;

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['messages'], 'readwrite');
      const store = transaction.objectStore('messages');

      const storedMessage: StoredMessage = {
        ...message,
        storedAt: Date.now(),
        synced,
        timestamp: message.timestamp instanceof Date ? message.timestamp : new Date(message.timestamp)
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

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['messages'], 'readonly');
      const store = transaction.objectStore('messages');
      const request = store.getAll();

      request.onsuccess = () => {
        const results = (request.result as StoredMessage[])
          .filter(m => 
            (m.senderId === deviceId1 && m.receiverId === deviceId2) ||
            (m.senderId === deviceId2 && m.receiverId === deviceId1)
          )
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
}

export const offlineStorage = new OfflineStorageService();
