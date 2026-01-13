// Global Mesh Relay Service
// Uses Supabase Realtime as a global signaling and relay server
// Enables worldwide mesh networking when direct connections aren't possible

import { supabase } from '@/integrations/supabase/client';
import { MeshDevice, MeshMessage, ConnectionType } from '@/types/mesh';
import { offlineStorage } from './OfflineStorageService';
import { RealtimeChannel } from '@supabase/supabase-js';

interface GlobalMeshEvents {
  onDeviceDiscovered: (device: MeshDevice) => void;
  onDeviceUpdated: (device: MeshDevice) => void;
  onDeviceLost: (deviceId: string) => void;
  onMessageReceived: (message: MeshMessage) => void;
  onMessageStatusChanged: (messageId: string, status: MeshMessage['status']) => void;
  onSignalReceived: (fromId: string, signal: any) => void;
  onOnlineStatusChanged: (isOnline: boolean) => void;
}

interface PresenceState {
  [key: string]: {
    device_id: string;
    device_name: string;
    device_type: string;
    online_at: string;
    is_typing: boolean;
    typing_to: string | null;
  }[];
}

/**
 * GlobalMeshRelay - Connects mesh networks worldwide via Supabase
 * Acts as signaling server for WebRTC and fallback relay for messages
 */
class GlobalMeshRelayService {
  private localDeviceId = '';
  private localDeviceName = '';
  private isInitialized = false;
  private isOnline = false;
  
  // Supabase channels
  private presenceChannel: RealtimeChannel | null = null;
  private signalChannel: RealtimeChannel | null = null;
  private messageChannel: RealtimeChannel | null = null;
  
  // Discovered devices
  private globalDevices: Map<string, MeshDevice> = new Map();
  
  // Event handlers
  private events: Partial<GlobalMeshEvents> = {};
  
  // Intervals
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private connectivityCheckInterval: NodeJS.Timeout | null = null;
  
  // Signaling queue for WebRTC
  private pendingSignals: Map<string, any[]> = new Map();
  
  // Track processed message IDs to avoid duplicates
  private processedMessageIds: Set<string> = new Set();

  setEventHandler<K extends keyof GlobalMeshEvents>(event: K, handler: GlobalMeshEvents[K]) {
    this.events[event] = handler;
  }

  async initialize(deviceId: string, deviceName: string): Promise<boolean> {
    if (this.isInitialized) return true;

    this.localDeviceId = deviceId;
    this.localDeviceName = deviceName;

    try {
      // Check connectivity
      this.isOnline = await this.checkConnectivity();
      this.events.onOnlineStatusChanged?.(this.isOnline);

      if (!this.isOnline) {
        console.log('[GlobalRelay] No network - will retry when online');
        this.startConnectivityMonitor();
        return true;
      }

      await this.connect();
      this.startConnectivityMonitor();
      
      this.isInitialized = true;
      console.log('[GlobalRelay] Initialized for device:', deviceId);
      return true;
    } catch (error) {
      console.error('[GlobalRelay] Initialization failed:', error);
      return false;
    }
  }

  private async checkConnectivity(): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      
      // Try to reach Supabase
      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/rest/v1/`, {
        method: 'HEAD',
        signal: controller.signal,
        headers: {
          'apikey': import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY
        }
      }).catch(() => null);
      
      clearTimeout(timeout);
      return response !== null && response.status !== 0;
    } catch {
      return false;
    }
  }

  private startConnectivityMonitor() {
    if (this.connectivityCheckInterval) {
      clearInterval(this.connectivityCheckInterval);
    }

    this.connectivityCheckInterval = setInterval(async () => {
      const wasOnline = this.isOnline;
      this.isOnline = await this.checkConnectivity();
      
      if (this.isOnline !== wasOnline) {
        this.events.onOnlineStatusChanged?.(this.isOnline);
        
        if (this.isOnline && !wasOnline) {
          console.log('[GlobalRelay] Network restored - reconnecting...');
          await this.connect();
        } else if (!this.isOnline && wasOnline) {
          console.log('[GlobalRelay] Network lost - entering offline mode');
        }
      }
    }, 10000);
  }

  private async connect() {
    try {
      // Register device in database
      await this.registerDevice();
      
      // Setup realtime presence
      await this.setupPresenceChannel();
      
      // Setup signaling channel (for WebRTC)
      await this.setupSignalingChannel();
      
      // Setup message relay channel
      await this.setupMessageChannel();
      
      // Fetch existing online devices
      await this.fetchOnlineDevices();
      
      // CRITICAL: Fetch historical messages for this device
      await this.fetchHistoricalMessages();
      
      // Start heartbeat
      this.startHeartbeat();
      
      console.log('[GlobalRelay] Connected to global mesh network');
    } catch (error) {
      console.error('[GlobalRelay] Connection failed:', error);
      throw error;
    }
  }

  private async registerDevice() {
    const { error } = await supabase
      .from('mesh_devices')
      .upsert({
        device_id: this.localDeviceId,
        device_name: this.localDeviceName,
        device_type: 'phone',
        is_online: true,
        last_seen: new Date().toISOString()
      }, { onConflict: 'device_id' });

    if (error) {
      console.error('[GlobalRelay] Failed to register device:', error);
    }

    // Also update presence
    await supabase
      .from('mesh_presence')
      .upsert({
        device_id: this.localDeviceId,
        is_online: true,
        is_typing: false,
        last_heartbeat: new Date().toISOString()
      }, { onConflict: 'device_id' });
  }

  private async setupPresenceChannel() {
    // Use Supabase Realtime presence for instant discovery
    this.presenceChannel = supabase.channel('mesh-global-presence', {
      config: {
        presence: {
          key: this.localDeviceId
        }
      }
    });

    this.presenceChannel
      .on('presence', { event: 'sync' }, () => {
        const state = this.presenceChannel?.presenceState() as PresenceState || {};
        this.handlePresenceSync(state);
      })
      .on('presence', { event: 'join' }, ({ key, newPresences }) => {
        this.handlePresenceJoin(key, newPresences);
      })
      .on('presence', { event: 'leave' }, ({ key }) => {
        this.handlePresenceLeave(key);
      })
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          // Track our presence
          await this.presenceChannel?.track({
            device_id: this.localDeviceId,
            device_name: this.localDeviceName,
            device_type: 'phone',
            online_at: new Date().toISOString(),
            is_typing: false,
            typing_to: null
          });
        }
      });
  }

  private handlePresenceSync(state: PresenceState) {
    Object.entries(state).forEach(([key, presences]) => {
      if (key === this.localDeviceId) return;
      
      const presence = presences[0];
      if (!presence) return;

      const device: MeshDevice = {
        id: presence.device_id,
        name: presence.device_name || `Device-${key.slice(0, 4)}`,
        signalStrength: 90,
        distance: 50,
        angle: Math.random() * 360,
        isConnected: true,
        isOnline: true,
        lastSeen: new Date(),
        type: (presence.device_type as MeshDevice['type']) || 'phone',
        connectionType: 'network',
        bluetoothEnabled: false,
        isSelf: false,
        isTyping: presence.is_typing
      };

      this.globalDevices.set(key, device);
      offlineStorage.saveDevice(device);
      this.events.onDeviceDiscovered?.(device);
    });
  }

  private handlePresenceJoin(key: string, presences: any[]) {
    if (key === this.localDeviceId) return;
    
    const presence = presences[0];
    if (!presence) return;

    const device: MeshDevice = {
      id: presence.device_id || key,
      name: presence.device_name || `Device-${key.slice(0, 4)}`,
      signalStrength: 90,
      distance: 50,
      angle: Math.random() * 360,
      isConnected: true,
      isOnline: true,
      lastSeen: new Date(),
      type: (presence.device_type as MeshDevice['type']) || 'phone',
      connectionType: 'network',
      bluetoothEnabled: false,
      isSelf: false,
      isTyping: presence.is_typing
    };

    const isNew = !this.globalDevices.has(key);
    this.globalDevices.set(key, device);
    offlineStorage.saveDevice(device);
    
    if (isNew) {
      console.log('[GlobalRelay] New device joined:', device.name);
      this.events.onDeviceDiscovered?.(device);
    } else {
      this.events.onDeviceUpdated?.(device);
    }
  }

  private handlePresenceLeave(key: string) {
    if (key === this.localDeviceId) return;
    
    const device = this.globalDevices.get(key);
    if (device) {
      device.isOnline = false;
      device.isConnected = false;
      this.globalDevices.set(key, device);
      this.events.onDeviceUpdated?.(device);
    }
  }

  private async setupSignalingChannel() {
    // Broadcast channel for WebRTC signaling
    this.signalChannel = supabase.channel('mesh-webrtc-signaling');

    this.signalChannel
      .on('broadcast', { event: 'signal' }, (payload) => {
        const { from, to, signal } = payload.payload;
        
        if (to === this.localDeviceId || to === '*') {
          console.log('[GlobalRelay] Received WebRTC signal from:', from);
          this.events.onSignalReceived?.(from, signal);
        }
      })
      .on('broadcast', { event: 'discovery' }, (payload) => {
        const { from, name, type } = payload.payload;
        
        if (from === this.localDeviceId) return;

        const device: MeshDevice = {
          id: from,
          name: name || `Device-${from.slice(0, 4)}`,
          signalStrength: 85,
          distance: 100,
          angle: Math.random() * 360,
          isConnected: true,
          isOnline: true,
          lastSeen: new Date(),
          type: type || 'phone',
          connectionType: 'network',
          bluetoothEnabled: false,
          isSelf: false
        };

        const isNew = !this.globalDevices.has(from);
        this.globalDevices.set(from, device);
        
        if (isNew) {
          this.events.onDeviceDiscovered?.(device);
        }
      })
      .subscribe();
  }

  private async setupMessageChannel() {
    // Listen for direct messages via database changes
    this.messageChannel = supabase.channel('mesh-messages-relay');

    this.messageChannel
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'mesh_messages' },
        async (payload) => {
          const m = payload.new as any;
          
          // Only process messages for us
          if (m.receiver_id !== this.localDeviceId) return;
          // Don't process our own messages
          if (m.sender_id === this.localDeviceId) return;
          // Don't process duplicates
          if (this.processedMessageIds.has(m.message_id)) return;
          
          this.processedMessageIds.add(m.message_id);

          // Check if already exists in local storage
          const exists = await offlineStorage.messageExists(m.message_id);
          if (exists) return;

          const message: MeshMessage = {
            id: m.message_id,
            content: m.content,
            senderId: m.sender_id,
            receiverId: m.receiver_id,
            timestamp: new Date(m.created_at || Date.now()),
            hops: m.hops || [],
            status: 'delivered'
          };

          console.log('[GlobalRelay] Message received via global relay:', message.id);
          
          // Save locally
          await offlineStorage.saveMessage(message, true);
          
          // Emit event
          this.events.onMessageReceived?.(message);

          // Mark as delivered
          this.markMessageDelivered(m.message_id);
        }
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'mesh_messages' },
        (payload) => {
          const m = payload.new as any;
          if (m.sender_id === this.localDeviceId && m.status === 'delivered') {
            this.events.onMessageStatusChanged?.(m.message_id, 'delivered');
          }
        }
      )
      .subscribe();
  }

  private async markMessageDelivered(messageId: string) {
    await supabase
      .from('mesh_messages')
      .update({ status: 'delivered' })
      .eq('message_id', messageId);
  }

  private async fetchHistoricalMessages() {
    console.log('[GlobalRelay] Fetching historical messages for:', this.localDeviceId);
    
    try {
      // Fetch messages where we are the receiver (messages sent TO us)
      const { data: receivedMessages, error: recvError } = await supabase
        .from('mesh_messages')
        .select('*')
        .eq('receiver_id', this.localDeviceId)
        .order('created_at', { ascending: true });

      if (recvError) {
        console.error('[GlobalRelay] Failed to fetch received messages:', recvError);
      } else {
        console.log('[GlobalRelay] Found', receivedMessages?.length || 0, 'messages for this device');
        
        for (const m of receivedMessages || []) {
          // Skip if already processed
          if (this.processedMessageIds.has(m.message_id)) continue;
          
          // Check if exists locally
          const exists = await offlineStorage.messageExists(m.message_id);
          if (exists) {
            this.processedMessageIds.add(m.message_id);
            continue;
          }

          const message: MeshMessage = {
            id: m.message_id,
            content: m.content,
            senderId: m.sender_id,
            receiverId: m.receiver_id,
            timestamp: new Date(m.created_at || Date.now()),
            hops: m.hops || [],
            status: (m.status as MeshMessage['status']) || 'delivered'
          };

          await offlineStorage.saveMessage(message, true);
          this.processedMessageIds.add(m.message_id);
          this.events.onMessageReceived?.(message);
        }
      }

      // Also fetch messages WE sent (so they show on other devices)
      const { data: sentMessages, error: sentError } = await supabase
        .from('mesh_messages')
        .select('*')
        .eq('sender_id', this.localDeviceId)
        .order('created_at', { ascending: true });

      if (sentError) {
        console.error('[GlobalRelay] Failed to fetch sent messages:', sentError);
      } else {
        for (const m of sentMessages || []) {
          if (this.processedMessageIds.has(m.message_id)) continue;
          
          const exists = await offlineStorage.messageExists(m.message_id);
          if (exists) {
            this.processedMessageIds.add(m.message_id);
            continue;
          }

          const message: MeshMessage = {
            id: m.message_id,
            content: m.content,
            senderId: m.sender_id,
            receiverId: m.receiver_id,
            timestamp: new Date(m.created_at || Date.now()),
            hops: m.hops || [],
            status: (m.status as MeshMessage['status']) || 'sent'
          };

          await offlineStorage.saveMessage(message, true);
          this.processedMessageIds.add(m.message_id);
        }
      }
    } catch (error) {
      console.error('[GlobalRelay] Error fetching historical messages:', error);
    }
  }

  private async fetchOnlineDevices() {
    const { data, error } = await supabase
      .from('mesh_devices')
      .select('*')
      .eq('is_online', true)
      .order('last_seen', { ascending: false });

    if (error) {
      console.error('[GlobalRelay] Failed to fetch devices:', error);
      return;
    }

    data?.forEach(d => {
      if (d.device_id === this.localDeviceId) return;

      const device: MeshDevice = {
        id: d.device_id,
        name: d.device_name,
        signalStrength: 80,
        distance: 100,
        angle: Math.random() * 360,
        isConnected: true,
        isOnline: d.is_online ?? false,
        lastSeen: new Date(d.last_seen || Date.now()),
        type: (d.device_type as MeshDevice['type']) || 'phone',
        connectionType: 'network',
        bluetoothEnabled: false,
        isSelf: false
      };

      this.globalDevices.set(d.device_id, device);
      offlineStorage.saveDevice(device);
      this.events.onDeviceDiscovered?.(device);
    });

    console.log('[GlobalRelay] Fetched', data?.length || 0, 'online devices');
  }

  private startHeartbeat() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
    }

    this.heartbeatInterval = setInterval(async () => {
      if (!this.isOnline) return;

      try {
        // Update device status
        await supabase
          .from('mesh_devices')
          .update({
            is_online: true,
            last_seen: new Date().toISOString()
          })
          .eq('device_id', this.localDeviceId);

        // Update presence
        await supabase
          .from('mesh_presence')
          .update({
            is_online: true,
            last_heartbeat: new Date().toISOString()
          })
          .eq('device_id', this.localDeviceId);
      } catch (error) {
        console.error('[GlobalRelay] Heartbeat failed:', error);
      }
    }, 20000);
  }

  // ============ PUBLIC API ============

  async sendMessage(content: string, receiverId: string): Promise<string> {
    const messageId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    if (!this.isOnline) {
      console.log('[GlobalRelay] Offline - message will be queued');
      return messageId;
    }

    try {
      const { error } = await supabase
        .from('mesh_messages')
        .insert({
          message_id: messageId,
          sender_id: this.localDeviceId,
          receiver_id: receiverId,
          content,
          status: 'sent',
          hops: [this.localDeviceId]
        });

      if (error) {
        console.error('[GlobalRelay] Failed to send message:', error);
        throw error;
      }

      // Mark as processed to avoid re-fetching
      this.processedMessageIds.add(messageId);

      console.log('[GlobalRelay] Message sent via global relay:', messageId);
      return messageId;
    } catch (error) {
      console.error('[GlobalRelay] Send failed:', error);
      throw error;
    }
  }

  async sendWebRTCSignal(targetId: string, signal: any) {
    if (!this.isOnline || !this.signalChannel) {
      // Queue signal for later
      const pending = this.pendingSignals.get(targetId) || [];
      pending.push(signal);
      this.pendingSignals.set(targetId, pending);
      return;
    }

    await this.signalChannel.send({
      type: 'broadcast',
      event: 'signal',
      payload: {
        from: this.localDeviceId,
        to: targetId,
        signal
      }
    });
  }

  async broadcastDiscovery() {
    if (!this.isOnline || !this.signalChannel) return;

    await this.signalChannel.send({
      type: 'broadcast',
      event: 'discovery',
      payload: {
        from: this.localDeviceId,
        name: this.localDeviceName,
        type: 'phone'
      }
    });
  }

  async setTypingIndicator(receiverId: string, isTyping: boolean) {
    if (!this.isOnline) return;

    try {
      // Update presence
      await this.presenceChannel?.track({
        device_id: this.localDeviceId,
        device_name: this.localDeviceName,
        device_type: 'phone',
        online_at: new Date().toISOString(),
        is_typing: isTyping,
        typing_to: isTyping ? receiverId : null
      });

      // Also update database
      await supabase
        .from('mesh_presence')
        .update({
          is_typing: isTyping,
          typing_to: isTyping ? receiverId : null
        })
        .eq('device_id', this.localDeviceId);
    } catch (error) {
      console.error('[GlobalRelay] Typing indicator failed:', error);
    }
  }

  getDevices(): MeshDevice[] {
    return Array.from(this.globalDevices.values());
  }

  getDevice(deviceId: string): MeshDevice | undefined {
    return this.globalDevices.get(deviceId);
  }

  getIsOnline(): boolean {
    return this.isOnline;
  }

  async syncPendingMessages(): Promise<void> {
    if (!this.isOnline) return;

    const pending = await offlineStorage.getUnsyncedMessages();
    
    for (const msg of pending) {
      try {
        await supabase
          .from('mesh_messages')
          .upsert({
            message_id: msg.id,
            sender_id: msg.senderId,
            receiver_id: msg.receiverId,
            content: msg.content,
            status: 'sent',
            hops: msg.hops
          }, { onConflict: 'message_id' });

        await offlineStorage.markMessageSynced(msg.id);
        this.processedMessageIds.add(msg.id);
        console.log('[GlobalRelay] Synced pending message:', msg.id);
      } catch (error) {
        console.error('[GlobalRelay] Failed to sync message:', msg.id, error);
      }
    }
  }

  async cleanup() {
    console.log('[GlobalRelay] Cleaning up...');

    // Mark device as offline
    if (this.localDeviceId) {
      try {
        await supabase
          .from('mesh_devices')
          .update({ is_online: false })
          .eq('device_id', this.localDeviceId);

        await supabase
          .from('mesh_presence')
          .update({ is_online: false })
          .eq('device_id', this.localDeviceId);
      } catch (e) {
        // Ignore cleanup errors
      }
    }

    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
    }
    if (this.connectivityCheckInterval) {
      clearInterval(this.connectivityCheckInterval);
    }

    // Unsubscribe from channels
    if (this.presenceChannel) {
      supabase.removeChannel(this.presenceChannel);
    }
    if (this.signalChannel) {
      supabase.removeChannel(this.signalChannel);
    }
    if (this.messageChannel) {
      supabase.removeChannel(this.messageChannel);
    }

    this.globalDevices.clear();
    this.pendingSignals.clear();
    this.processedMessageIds.clear();
    this.isInitialized = false;
  }
}

export const globalMeshRelay = new GlobalMeshRelayService();