import { useState, useEffect, useCallback, useRef } from 'react';
import { MeshDevice, MeshMessage, ConnectionType } from '@/types/mesh';
import { meshService } from '@/services/BluetoothMeshService';
import { networkFallback, offlineQueue, NetworkStatusInfo } from '@/services/NetworkFallbackService';
import { multiTransportMesh } from '@/services/MultiTransportMesh';
import { webRTCMesh } from '@/services/WebRTCMeshService';
import { nearbyConnections } from '@/services/NearbyConnectionsService';
import { Capacitor } from '@capacitor/core';
import { Preferences } from '@capacitor/preferences';
import { supabase } from '@/integrations/supabase/client';

// Generate a consistent device ID
const generateDeviceId = () => Math.random().toString(36).substring(2, 10).toUpperCase();

// Check if running on native platform
const isNative = Capacitor.isNativePlatform();

// Device names for simulation
const deviceNames = [
  'Galaxy Node', 'Pixel Relay', 'iPhone Mesh', 'OnePlus Link',
  'Xiaomi Hub', 'Oppo Bridge', 'Vivo Connect', 'Samsung Beacon',
  'Motorola Point', 'Nokia Station', 'LG Gateway', 'Sony Router'
];

const deviceTypes: MeshDevice['type'][] = ['phone', 'tablet', 'laptop', 'desktop', 'unknown'];

export const useMeshNetwork = () => {
  const [devices, setDevices] = useState<MeshDevice[]>([]);
  const [messages, setMessages] = useState<MeshMessage[]>([]);
  const [isScanning, setIsScanning] = useState(false);
  const [localDeviceId, setLocalDeviceId] = useState('');
  const [localDeviceName, setLocalDeviceName] = useState('My Device');
  const [connectionMethod, setConnectionMethod] = useState<ConnectionType>('unknown');
  const [networkStatus, setNetworkStatus] = useState<NetworkStatusInfo | null>(null);
  const [isInitialized, setIsInitialized] = useState(false);
  const [typingUsers, setTypingUsers] = useState<Map<string, boolean>>(new Map());
  
  const initializationRef = useRef(false);
  const broadcastChannelRef = useRef<BroadcastChannel | null>(null);
  const presenceIntervalRef = useRef<number | null>(null);
  const heartbeatIntervalRef = useRef<number | null>(null);
  const deviceIdRef = useRef<string>('');

  // Register device with Supabase (global mesh)
  const registerDevice = useCallback(async (deviceId: string, deviceName: string) => {
    try {
      console.log('[MeshNetwork] Registering device globally:', deviceId);
      
      // Upsert device
      const { error: deviceError } = await supabase
        .from('mesh_devices')
        .upsert({
          device_id: deviceId,
          device_name: deviceName,
          is_online: true,
          last_seen: new Date().toISOString(),
          device_type: isNative ? 'phone' : 'desktop'
        }, { onConflict: 'device_id' });

      if (deviceError) console.error('[MeshNetwork] Device registration error:', deviceError);

      // Upsert presence
      const { error: presenceError } = await supabase
        .from('mesh_presence')
        .upsert({
          device_id: deviceId,
          is_online: true,
          is_typing: false,
          last_heartbeat: new Date().toISOString()
        }, { onConflict: 'device_id' });

      if (presenceError) console.error('[MeshNetwork] Presence error:', presenceError);
    } catch (err) {
      console.error('[MeshNetwork] Registration failed:', err);
    }
  }, []);

  // Load all devices from Supabase
  const loadGlobalDevices = useCallback(async (myDeviceId: string) => {
    try {
      console.log('[MeshNetwork] Loading global devices...');
      const { data, error } = await supabase
        .from('mesh_devices')
        .select('*')
        .order('last_seen', { ascending: false });

      if (error) {
        console.error('[MeshNetwork] Failed to load devices:', error);
        return;
      }

      if (data) {
        const meshDevices: MeshDevice[] = data.map(d => ({
          id: d.device_id,
          name: d.device_name,
          signalStrength: d.is_online ? 90 : 30,
          distance: 10,
          angle: Math.random() * 360,
          isConnected: d.is_online ?? false,
          isOnline: d.is_online ?? false,
          lastSeen: new Date(d.last_seen || Date.now()),
          type: (d.device_type as MeshDevice['type']) || 'phone',
          connectionType: 'network' as ConnectionType,
          bluetoothEnabled: true,
          isSelf: d.device_id === myDeviceId,
          isTyping: false
        }));

        console.log('[MeshNetwork] Loaded', meshDevices.length, 'devices from cloud');
        setDevices(meshDevices);
      }
    } catch (err) {
      console.error('[MeshNetwork] Error loading devices:', err);
    }
  }, []);

  // Load messages from Supabase
  const loadMessages = useCallback(async (myDeviceId: string) => {
    try {
      console.log('[MeshNetwork] Loading messages...');
      const { data, error } = await supabase
        .from('mesh_messages')
        .select('*')
        .or(`sender_id.eq.${myDeviceId},receiver_id.eq.${myDeviceId}`)
        .order('created_at', { ascending: true });

      if (error) {
        console.error('[MeshNetwork] Failed to load messages:', error);
        return;
      }

      if (data) {
        const meshMessages: MeshMessage[] = data.map(m => ({
          id: m.message_id,
          content: m.content,
          senderId: m.sender_id,
          receiverId: m.receiver_id,
          timestamp: new Date(m.created_at || Date.now()),
          hops: m.hops || [],
          status: (m.status as MeshMessage['status']) || 'sent'
        }));

        console.log('[MeshNetwork] Loaded', meshMessages.length, 'messages from cloud');
        setMessages(meshMessages);
      }
    } catch (err) {
      console.error('[MeshNetwork] Error loading messages:', err);
    }
  }, []);

  // Send heartbeat to keep presence alive
  const sendHeartbeat = useCallback(async (deviceId: string) => {
    try {
      await supabase
        .from('mesh_presence')
        .update({ 
          is_online: true, 
          last_heartbeat: new Date().toISOString() 
        })
        .eq('device_id', deviceId);
      
      await supabase
        .from('mesh_devices')
        .update({ 
          is_online: true, 
          last_seen: new Date().toISOString() 
        })
        .eq('device_id', deviceId);
    } catch (err) {
      console.error('[MeshNetwork] Heartbeat error:', err);
    }
  }, []);

  // Initialize the mesh network services
  useEffect(() => {
    if (initializationRef.current) return;
    initializationRef.current = true;

    const initializeMesh = async () => {
      try {
        console.log('[MeshNetwork] Initializing mesh network...');
        
        // Load or generate device ID
        let deviceId = '';
        let deviceName = 'My Device';
        
        try {
          const { value: storedId } = await Preferences.get({ key: 'mesh_device_id' });
          const { value: storedName } = await Preferences.get({ key: 'mesh_device_name' });
          
          if (storedId) {
            deviceId = storedId;
          } else {
            deviceId = generateDeviceId();
            await Preferences.set({ key: 'mesh_device_id', value: deviceId });
          }
          
          if (storedName) {
            deviceName = storedName;
          } else {
            deviceName = `MeshUser-${deviceId.slice(0, 4)}`;
            await Preferences.set({ key: 'mesh_device_name', value: deviceName });
          }
        } catch (e) {
          deviceId = generateDeviceId();
          deviceName = `MeshUser-${deviceId.slice(0, 4)}`;
        }

        deviceIdRef.current = deviceId;
        setLocalDeviceId(deviceId);
        setLocalDeviceName(deviceName);

        console.log('[MeshNetwork] Device ID:', deviceId, 'Name:', deviceName);

        // Register with Supabase (global mesh)
        await registerDevice(deviceId, deviceName);
        
        // Load existing devices and messages
        await loadGlobalDevices(deviceId);
        await loadMessages(deviceId);

        // Initialize core mesh service
        await multiTransportMesh.initialize();

        // Set up event handlers for local mesh
        multiTransportMesh.setEventHandler('onDeviceDiscovered', (device) => {
          setDevices(prev => {
            if (prev.find(d => d.id === device.id)) return prev;
            return [...prev, { ...device, isOnline: device.isConnected }];
          });
        });

        multiTransportMesh.setEventHandler('onMessageReceived', (message) => {
          setMessages(prev => {
            if (prev.find(m => m.id === message.id)) return prev;
            return [...prev, message];
          });
        });

        // Setup BroadcastChannel for same-origin app-to-app messaging
        if (typeof BroadcastChannel !== 'undefined') {
          console.log('[MeshNetwork] Setting up BroadcastChannel...');
          const channel = new BroadcastChannel('meshlink_global');
          broadcastChannelRef.current = channel;

          channel.onmessage = (event) => {
            const data = event.data;
            console.log('[MeshNetwork] BroadcastChannel message received:', data.type);
            
            if (data.from === deviceId) return;

            if (data.type === 'PRESENCE') {
              const peerDevice: MeshDevice = {
                id: data.from,
                name: data.name || `Device-${data.from.slice(0, 4)}`,
                signalStrength: 95,
                distance: 1,
                angle: Math.random() * 360,
                isConnected: true,
                isOnline: true,
                lastSeen: new Date(),
                type: 'phone',
                connectionType: 'webrtc',
                bluetoothEnabled: false,
                isSelf: false
              };
              
              setDevices(prev => {
                const existing = prev.find(d => d.id === data.from);
                if (existing) {
                  return prev.map(d => d.id === data.from ? { ...d, isOnline: true, lastSeen: new Date() } : d);
                }
                return [...prev, peerDevice];
              });
            } else if (data.type === 'MESSAGE' && (data.to === deviceId || data.to === '*')) {
              console.log('[MeshNetwork] Received message via BroadcastChannel:', data.content);
              const message: MeshMessage = {
                id: data.id || `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                content: data.content,
                senderId: data.from,
                receiverId: deviceId,
                timestamp: new Date(data.timestamp || Date.now()),
                hops: data.hops || [data.from],
                status: 'delivered'
              };
              
              setMessages(prev => {
                if (prev.find(m => m.id === message.id)) return prev;
                return [...prev, message];
              });

              channel.postMessage({
                type: 'ACK',
                from: deviceId,
                to: data.from,
                messageId: message.id
              });
            } else if (data.type === 'ACK' && data.to === deviceId) {
              setMessages(prev => prev.map(m => 
                m.id === data.messageId ? { ...m, status: 'delivered' } : m
              ));
            } else if (data.type === 'TYPING') {
              if (data.to === deviceId || data.to === '*') {
                setTypingUsers(prev => new Map(prev).set(data.from, data.isTyping));
                setDevices(prev => prev.map(d => 
                  d.id === data.from ? { ...d, isTyping: data.isTyping } : d
                ));
              }
            }
          };

          // Announce presence immediately
          channel.postMessage({
            type: 'PRESENCE',
            from: deviceId,
            name: deviceName,
            timestamp: Date.now()
          });

          // Periodic presence announcements
          presenceIntervalRef.current = window.setInterval(() => {
            channel.postMessage({
              type: 'PRESENCE',
              from: deviceIdRef.current,
              name: deviceName,
              timestamp: Date.now()
            });
          }, 3000);
        }

        // Setup Supabase Realtime for global messaging
        console.log('[MeshNetwork] Setting up Supabase Realtime...');
        
        // Listen for new devices
        const devicesChannel = supabase
          .channel('mesh-devices-changes')
          .on(
            'postgres_changes',
            { event: '*', schema: 'public', table: 'mesh_devices' },
            (payload) => {
              console.log('[MeshNetwork] Device change:', payload.eventType);
              if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
                const d = payload.new as any;
                if (d.device_id === deviceId) return;
                
                setDevices(prev => {
                  const existing = prev.find(device => device.id === d.device_id);
                  const newDevice: MeshDevice = {
                    id: d.device_id,
                    name: d.device_name,
                    signalStrength: d.is_online ? 85 : 30,
                    distance: 20,
                    angle: Math.random() * 360,
                    isConnected: d.is_online ?? false,
                    isOnline: d.is_online ?? false,
                    lastSeen: new Date(d.last_seen || Date.now()),
                    type: (d.device_type as MeshDevice['type']) || 'phone',
                    connectionType: 'network',
                    bluetoothEnabled: true,
                    isSelf: false
                  };
                  
                  if (existing) {
                    return prev.map(device => device.id === d.device_id ? { ...device, ...newDevice } : device);
                  }
                  return [...prev, newDevice];
                });
              }
            }
          )
          .subscribe();

        // Listen for new messages
        const messagesChannel = supabase
          .channel('mesh-messages-changes')
          .on(
            'postgres_changes',
            { event: 'INSERT', schema: 'public', table: 'mesh_messages' },
            (payload) => {
              console.log('[MeshNetwork] New message received via Supabase Realtime');
              const m = payload.new as any;
              
              // Only process if we're the receiver
              if (m.receiver_id !== deviceId && m.sender_id !== deviceId) return;
              
              const newMessage: MeshMessage = {
                id: m.message_id,
                content: m.content,
                senderId: m.sender_id,
                receiverId: m.receiver_id,
                timestamp: new Date(m.created_at || Date.now()),
                hops: m.hops || [],
                status: m.sender_id === deviceId ? (m.status as MeshMessage['status']) : 'delivered'
              };
              
              setMessages(prev => {
                if (prev.find(msg => msg.id === newMessage.id)) return prev;
                return [...prev, newMessage];
              });

              // Update status to delivered if we're the receiver
              if (m.receiver_id === deviceId && m.sender_id !== deviceId) {
                supabase
                  .from('mesh_messages')
                  .update({ status: 'delivered' })
                  .eq('message_id', m.message_id)
                  .then(() => console.log('[MeshNetwork] Marked message as delivered'));
              }
            }
          )
          .subscribe();

        // Listen for presence/typing updates
        const presenceChannel = supabase
          .channel('mesh-presence-changes')
          .on(
            'postgres_changes',
            { event: '*', schema: 'public', table: 'mesh_presence' },
            (payload) => {
              if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
                const p = payload.new as any;
                if (p.device_id === deviceId) return;
                
                setDevices(prev => prev.map(d => 
                  d.id === p.device_id 
                    ? { ...d, isOnline: p.is_online, isTyping: p.is_typing } 
                    : d
                ));
                
                if (p.is_typing && p.typing_to === deviceId) {
                  setTypingUsers(prev => new Map(prev).set(p.device_id, true));
                } else {
                  setTypingUsers(prev => {
                    const next = new Map(prev);
                    next.delete(p.device_id);
                    return next;
                  });
                }
              }
            }
          )
          .subscribe();

        // Heartbeat to keep online status
        heartbeatIntervalRef.current = window.setInterval(() => {
          sendHeartbeat(deviceIdRef.current);
        }, 10000);

        if (isNative) {
          await meshService.initialize();
          await nearbyConnections.initialize(deviceId, deviceName);
          const status = await networkFallback.initialize();
          setNetworkStatus(status);
          setConnectionMethod(status.connectionType as ConnectionType);

          networkFallback.setEventHandler('onStatusChanged', (status) => {
            setNetworkStatus(status);
          });

          await offlineQueue.load();
          const queuedMessages = offlineQueue.getAll();
          if (queuedMessages.length > 0) {
            setMessages(prev => [...prev, ...queuedMessages]);
          }
        }

        await webRTCMesh.initialize(deviceId);

        setIsInitialized(true);
        console.log('[MeshNetwork] Initialization complete!');
      } catch (error) {
        console.error('[MeshNetwork] Failed to initialize:', error);
        setIsInitialized(true);
      }
    };

    initializeMesh();

    // Cleanup function
    return () => {
      console.log('[MeshNetwork] Cleaning up...');
      
      if (presenceIntervalRef.current) {
        clearInterval(presenceIntervalRef.current);
      }
      if (heartbeatIntervalRef.current) {
        clearInterval(heartbeatIntervalRef.current);
      }
      if (broadcastChannelRef.current) {
        broadcastChannelRef.current.close();
      }
      
      // Mark device as offline
      if (deviceIdRef.current) {
        supabase
          .from('mesh_presence')
          .update({ is_online: false })
          .eq('device_id', deviceIdRef.current);
        
        supabase
          .from('mesh_devices')
          .update({ is_online: false })
          .eq('device_id', deviceIdRef.current);
      }

      if (isNative) {
        meshService.disconnect();
        networkFallback.cleanup();
      }
    };
  }, [registerDevice, loadGlobalDevices, loadMessages, sendHeartbeat]);

  const startScanning = useCallback(async () => {
    console.log('[MeshNetwork] Starting scan...');
    setIsScanning(true);
    
    // Refresh global devices
    await loadGlobalDevices(deviceIdRef.current);
    
    if (isNative) {
      await meshService.startScan();
      multiTransportMesh.setScanning(true);
    }
    
    setTimeout(() => setIsScanning(false), 5000);
  }, [loadGlobalDevices]);

  const stopScanning = useCallback(async () => {
    if (isNative) {
      await meshService.stopScan();
      multiTransportMesh.setScanning(false);
    }
    setIsScanning(false);
  }, []);

  const sendMessage = useCallback(async (content: string, receiverId: string) => {
    const messageId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    console.log('[MeshNetwork] Sending message:', messageId, 'to:', receiverId);
    
    const newMessage: MeshMessage = {
      id: messageId,
      content,
      senderId: localDeviceId,
      receiverId,
      timestamp: new Date(),
      hops: [localDeviceId],
      status: 'sending',
      retryCount: 0
    };

    setMessages(prev => [...prev, newMessage]);

    try {
      // Save to Supabase (global delivery)
      const { error } = await supabase
        .from('mesh_messages')
        .insert({
          message_id: messageId,
          sender_id: localDeviceId,
          receiver_id: receiverId,
          content,
          status: 'sent',
          hops: [localDeviceId]
        });

      if (error) {
        console.error('[MeshNetwork] Failed to save message to cloud:', error);
        setMessages(prev => prev.map(m => m.id === messageId ? { ...m, status: 'failed' } : m));
        return;
      }

      console.log('[MeshNetwork] Message saved to cloud');

      // Also send via BroadcastChannel for same-origin delivery
      if (broadcastChannelRef.current) {
        broadcastChannelRef.current.postMessage({
          type: 'MESSAGE',
          id: messageId,
          from: localDeviceId,
          to: receiverId,
          content,
          timestamp: Date.now(),
          hops: [localDeviceId]
        });
      }

      // Update local status
      setMessages(prev => prev.map(m => m.id === messageId ? { ...m, status: 'sent' } : m));

      // Simulate delivery confirmation after a delay
      setTimeout(() => {
        setMessages(prev => prev.map(m => 
          m.id === messageId && m.status === 'sent' ? { ...m, status: 'delivered' } : m
        ));
      }, 1500);

      // Simulate read after longer delay
      setTimeout(() => {
        setMessages(prev => prev.map(m => 
          m.id === messageId && m.status === 'delivered' ? { ...m, status: 'read' } : m
        ));
      }, 5000);

      if (isNative) {
        try {
          await meshService.sendMessage(content, receiverId);
          await multiTransportMesh.sendMessage(content, receiverId);
        } catch (err) {
          console.error('[MeshNetwork] Native send error:', err);
        }
      }
    } catch (err) {
      console.error('[MeshNetwork] Send error:', err);
      setMessages(prev => prev.map(m => m.id === messageId ? { ...m, status: 'failed' } : m));
    }
  }, [localDeviceId]);

  const sendTypingIndicator = useCallback(async (receiverId: string, isTyping: boolean) => {
    // Via BroadcastChannel
    if (broadcastChannelRef.current) {
      broadcastChannelRef.current.postMessage({
        type: 'TYPING',
        from: localDeviceId,
        to: receiverId,
        isTyping
      });
    }

    // Via Supabase
    try {
      await supabase
        .from('mesh_presence')
        .update({ 
          is_typing: isTyping, 
          typing_to: isTyping ? receiverId : null 
        })
        .eq('device_id', localDeviceId);
    } catch (err) {
      console.error('[MeshNetwork] Typing indicator error:', err);
    }
  }, [localDeviceId]);

  const refreshDevice = useCallback(async (deviceId: string) => {
    await loadGlobalDevices(deviceIdRef.current);
  }, [loadGlobalDevices]);

  const retryMessage = useCallback(async (messageId: string) => {
    const message = messages.find(m => m.id === messageId);
    if (!message || message.status !== 'failed') return;

    setMessages(prev =>
      prev.map(m => m.id === messageId ? { ...m, status: 'sending', retryCount: (m.retryCount || 0) + 1 } : m)
    );

    try {
      const { error } = await supabase
        .from('mesh_messages')
        .upsert({
          message_id: messageId,
          sender_id: message.senderId,
          receiver_id: message.receiverId,
          content: message.content,
          status: 'sent',
          hops: message.hops
        }, { onConflict: 'message_id' });

      if (error) throw error;

      setMessages(prev => prev.map(m => m.id === messageId ? { ...m, status: 'sent' } : m));
    } catch (err) {
      setMessages(prev => prev.map(m => m.id === messageId ? { ...m, status: 'failed' } : m));
    }
  }, [messages]);

  return {
    devices,
    messages,
    isScanning,
    localDeviceId,
    localDeviceName,
    connectionMethod,
    networkStatus,
    isInitialized,
    isNative,
    typingUsers,
    startScanning,
    stopScanning,
    sendMessage,
    sendTypingIndicator,
    refreshDevice,
    retryMessage,
  };
};
