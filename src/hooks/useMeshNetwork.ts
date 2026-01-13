import { useState, useEffect, useCallback, useRef } from 'react';
import { MeshDevice, MeshMessage, ConnectionType } from '@/types/mesh';
import { meshService } from '@/services/BluetoothMeshService';
import { networkFallback, offlineQueue, NetworkStatusInfo } from '@/services/NetworkFallbackService';
import { multiTransportMesh } from '@/services/MultiTransportMesh';
import { webRTCMesh } from '@/services/WebRTCMeshService';
import { nearbyConnections } from '@/services/NearbyConnectionsService';
import { localMesh } from '@/services/LocalMeshService';
import { offlineStorage } from '@/services/OfflineStorageService';
import { Capacitor } from '@capacitor/core';
import { Preferences } from '@capacitor/preferences';
import { supabase } from '@/integrations/supabase/client';

// Generate a consistent device ID
const generateDeviceId = () => Math.random().toString(36).substring(2, 10).toUpperCase();

// Check if running on native platform
const isNative = Capacitor.isNativePlatform();

// Check if we have network connectivity
const checkNetworkConnectivity = async (): Promise<boolean> => {
  try {
    // Simple connectivity check without relying on external service
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    
    const response = await fetch('https://undlzvhhimdjdtcwvhnh.supabase.co/rest/v1/', {
      method: 'HEAD',
      signal: controller.signal
    }).catch(() => null);
    
    clearTimeout(timeout);
    return response?.ok ?? false;
  } catch {
    return false;
  }
};

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
  const [isOnline, setIsOnline] = useState(false);
  
  const initializationRef = useRef(false);
  const deviceIdRef = useRef<string>('');
  const heartbeatIntervalRef = useRef<number | null>(null);
  const syncIntervalRef = useRef<number | null>(null);

  // Sync devices and messages with Supabase (when online)
  const syncWithCloud = useCallback(async (deviceId: string, deviceName: string) => {
    const hasNetwork = await checkNetworkConnectivity();
    setIsOnline(hasNetwork);
    
    if (!hasNetwork) {
      console.log('[MeshNetwork] No network - operating in offline mode');
      return;
    }

    try {
      console.log('[MeshNetwork] Syncing with cloud...');
      
      // Register/update our device
      await supabase
        .from('mesh_devices')
        .upsert({
          device_id: deviceId,
          device_name: deviceName,
          is_online: true,
          last_seen: new Date().toISOString(),
          device_type: isNative ? 'phone' : 'desktop'
        }, { onConflict: 'device_id' });

      // Update presence
      await supabase
        .from('mesh_presence')
        .upsert({
          device_id: deviceId,
          is_online: true,
          is_typing: false,
          last_heartbeat: new Date().toISOString()
        }, { onConflict: 'device_id' });

      // Fetch global devices
      const { data: cloudDevices } = await supabase
        .from('mesh_devices')
        .select('*')
        .order('last_seen', { ascending: false });

      if (cloudDevices) {
        cloudDevices.forEach(d => {
          if (d.device_id !== deviceId) {
            const device: MeshDevice = {
              id: d.device_id,
              name: d.device_name,
              signalStrength: d.is_online ? 80 : 30,
              distance: 100,
              angle: Math.random() * 360,
              isConnected: d.is_online ?? false,
              isOnline: d.is_online ?? false,
              lastSeen: new Date(d.last_seen || Date.now()),
              type: (d.device_type as MeshDevice['type']) || 'phone',
              connectionType: 'network',
              bluetoothEnabled: true,
              isSelf: false
            };
            
            // Save to offline storage
            offlineStorage.saveDevice(device);
            
            setDevices(prev => {
              const existing = prev.find(dev => dev.id === device.id);
              if (existing) {
                return prev.map(dev => dev.id === device.id ? { ...dev, ...device } : dev);
              }
              return [...prev, device];
            });
          }
        });
      }

      // Fetch messages
      const { data: cloudMessages } = await supabase
        .from('mesh_messages')
        .select('*')
        .or(`sender_id.eq.${deviceId},receiver_id.eq.${deviceId}`)
        .order('created_at', { ascending: true });

      if (cloudMessages) {
        cloudMessages.forEach(m => {
          const message: MeshMessage = {
            id: m.message_id,
            content: m.content,
            senderId: m.sender_id,
            receiverId: m.receiver_id,
            timestamp: new Date(m.created_at || Date.now()),
            hops: m.hops || [],
            status: (m.status as MeshMessage['status']) || 'sent'
          };
          
          // Save to offline storage
          offlineStorage.saveMessage(message, true);
          
          setMessages(prev => {
            if (prev.find(msg => msg.id === message.id)) return prev;
            return [...prev, message];
          });
        });
      }

      // Sync unsent local messages to cloud
      const unsynced = await offlineStorage.getUnsyncedMessages();
      for (const msg of unsynced) {
        if (msg.senderId === deviceId) {
          await supabase
            .from('mesh_messages')
            .upsert({
              message_id: msg.id,
              sender_id: msg.senderId,
              receiver_id: msg.receiverId,
              content: msg.content,
              status: msg.status,
              hops: msg.hops
            }, { onConflict: 'message_id' });
          
          await offlineStorage.markMessageSynced(msg.id);
        }
      }

      console.log('[MeshNetwork] Cloud sync complete');
    } catch (err) {
      console.error('[MeshNetwork] Cloud sync failed:', err);
    }
  }, []);

  // Initialize the mesh network
  useEffect(() => {
    if (initializationRef.current) return;
    initializationRef.current = true;

    const initializeMesh = async () => {
      try {
        console.log('[MeshNetwork] Initializing offline-first mesh network...');
        
        // Initialize offline storage first
        await offlineStorage.initialize();
        
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

        // Load cached data from offline storage
        const cachedDevices = await offlineStorage.getAllDevices();
        const cachedMessages = await offlineStorage.getAllMessages(deviceId);
        
        setDevices(cachedDevices.filter(d => !d.isSelf));
        setMessages(cachedMessages);
        
        console.log('[MeshNetwork] Loaded', cachedDevices.length, 'cached devices,', cachedMessages.length, 'cached messages');

        // Initialize local mesh (works offline)
        await localMesh.initialize(deviceId, deviceName);

        // Setup local mesh event handlers
        localMesh.setEventHandler('onDeviceDiscovered', (device) => {
          console.log('[MeshNetwork] Local device discovered:', device.id);
          setDevices(prev => {
            const existing = prev.find(d => d.id === device.id);
            if (existing) {
              return prev.map(d => d.id === device.id ? { ...d, ...device } : d);
            }
            return [...prev, device];
          });
        });

        localMesh.setEventHandler('onDeviceUpdated', (device) => {
          setDevices(prev => prev.map(d => d.id === device.id ? { ...d, ...device } : d));
        });

        localMesh.setEventHandler('onDeviceLost', (deviceId) => {
          setDevices(prev => prev.map(d => 
            d.id === deviceId ? { ...d, isOnline: false, isConnected: false } : d
          ));
        });

        localMesh.setEventHandler('onMessageReceived', (message) => {
          console.log('[MeshNetwork] Received message via local mesh:', message.id);
          setMessages(prev => {
            if (prev.find(m => m.id === message.id)) return prev;
            return [...prev, message];
          });
        });

        localMesh.setEventHandler('onMessageDelivered', (messageId) => {
          setMessages(prev => prev.map(m => 
            m.id === messageId ? { ...m, status: 'delivered' } : m
          ));
        });

        // Initialize core mesh service
        await multiTransportMesh.initialize();

        // Set up event handlers for multi-transport mesh
        multiTransportMesh.setEventHandler('onDeviceDiscovered', (device) => {
          setDevices(prev => {
            if (prev.find(d => d.id === device.id)) return prev;
            offlineStorage.saveDevice(device);
            return [...prev, { ...device, isOnline: device.isConnected }];
          });
        });

        multiTransportMesh.setEventHandler('onMessageReceived', (message) => {
          setMessages(prev => {
            if (prev.find(m => m.id === message.id)) return prev;
            offlineStorage.saveMessage(message, false);
            return [...prev, message];
          });
        });

        // Initialize WebRTC (works on local network without internet)
        await webRTCMesh.initialize(deviceId);

        // Setup Supabase Realtime (when online)
        const hasNetwork = await checkNetworkConnectivity();
        setIsOnline(hasNetwork);
        
        if (hasNetwork) {
          console.log('[MeshNetwork] Network available - setting up cloud sync...');
          
          // Initial sync
          await syncWithCloud(deviceId, deviceName);
          
          // Listen for new devices
          supabase
            .channel('mesh-devices-changes')
            .on(
              'postgres_changes',
              { event: '*', schema: 'public', table: 'mesh_devices' },
              (payload) => {
                if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
                  const d = payload.new as any;
                  if (d.device_id === deviceId) return;
                  
                  const device: MeshDevice = {
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
                  
                  offlineStorage.saveDevice(device);
                  
                  setDevices(prev => {
                    const existing = prev.find(dev => dev.id === d.device_id);
                    if (existing) {
                      return prev.map(dev => dev.id === d.device_id ? { ...dev, ...device } : dev);
                    }
                    return [...prev, device];
                  });
                }
              }
            )
            .subscribe();

          // Listen for new messages
          supabase
            .channel('mesh-messages-changes')
            .on(
              'postgres_changes',
              { event: 'INSERT', schema: 'public', table: 'mesh_messages' },
              (payload) => {
                const m = payload.new as any;
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
                
                offlineStorage.saveMessage(newMessage, true);
                
                setMessages(prev => {
                  if (prev.find(msg => msg.id === newMessage.id)) return prev;
                  return [...prev, newMessage];
                });

                // Mark as delivered if we're the receiver
                if (m.receiver_id === deviceId && m.sender_id !== deviceId) {
                  supabase
                    .from('mesh_messages')
                    .update({ status: 'delivered' })
                    .eq('message_id', m.message_id);
                }
              }
            )
            .subscribe();

          // Listen for presence/typing
          supabase
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

          // Periodic cloud heartbeat
          heartbeatIntervalRef.current = window.setInterval(async () => {
            const online = await checkNetworkConnectivity();
            setIsOnline(online);
            
            if (online) {
              await supabase
                .from('mesh_presence')
                .update({ 
                  is_online: true, 
                  last_heartbeat: new Date().toISOString() 
                })
                .eq('device_id', deviceIdRef.current);
              
              await supabase
                .from('mesh_devices')
                .update({ 
                  is_online: true, 
                  last_seen: new Date().toISOString() 
                })
                .eq('device_id', deviceIdRef.current);
            }
          }, 15000);

          // Periodic sync
          syncIntervalRef.current = window.setInterval(() => {
            syncWithCloud(deviceIdRef.current, deviceName);
          }, 30000);
        }

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

        setIsInitialized(true);
        console.log('[MeshNetwork] Initialization complete! (Offline-first mode)');
      } catch (error) {
        console.error('[MeshNetwork] Failed to initialize:', error);
        setIsInitialized(true);
      }
    };

    initializeMesh();

    // Cleanup function
    return () => {
      console.log('[MeshNetwork] Cleaning up...');
      
      if (heartbeatIntervalRef.current) {
        clearInterval(heartbeatIntervalRef.current);
      }
      if (syncIntervalRef.current) {
        clearInterval(syncIntervalRef.current);
      }
      
      localMesh.cleanup();
      
      // Mark device as offline (if online)
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
  }, [syncWithCloud]);

  const startScanning = useCallback(async () => {
    console.log('[MeshNetwork] Starting scan...');
    setIsScanning(true);
    
    // Load cached devices
    const cachedDevices = await offlineStorage.getAllDevices();
    setDevices(prev => {
      const newDevices = cachedDevices.filter(d => !prev.find(p => p.id === d.id) && !d.isSelf);
      return [...prev, ...newDevices];
    });
    
    // Sync with cloud if online
    if (isOnline) {
      await syncWithCloud(deviceIdRef.current, localDeviceName);
    }
    
    if (isNative) {
      await meshService.startScan();
      multiTransportMesh.setScanning(true);
    }
    
    setTimeout(() => setIsScanning(false), 5000);
  }, [isOnline, localDeviceName, syncWithCloud]);

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

    // Save to offline storage immediately
    await offlineStorage.saveMessage(newMessage, false);

    // Try local mesh first (works offline)
    try {
      await localMesh.sendMessage(content, receiverId);
      console.log('[MeshNetwork] Message sent via local mesh');
    } catch (err) {
      console.log('[MeshNetwork] Local mesh send failed:', err);
    }

    // Also try cloud delivery if online
    const hasNetwork = await checkNetworkConnectivity();
    
    if (hasNetwork) {
      try {
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
          console.error('[MeshNetwork] Cloud send failed:', error);
        } else {
          console.log('[MeshNetwork] Message sent via cloud');
          await offlineStorage.markMessageSynced(messageId);
        }
      } catch (err) {
        console.error('[MeshNetwork] Cloud send error:', err);
      }
    } else {
      // Queue for later sync
      await offlineStorage.addToPendingQueue(newMessage);
      console.log('[MeshNetwork] Message queued for later sync');
    }

    // Update local status
    setMessages(prev => prev.map(m => m.id === messageId ? { ...m, status: 'sent' } : m));

    // Simulate delivery confirmation after delay
    setTimeout(() => {
      setMessages(prev => prev.map(m => 
        m.id === messageId && m.status === 'sent' ? { ...m, status: 'delivered' } : m
      ));
      offlineStorage.updateMessageStatus(messageId, 'delivered');
    }, 1500);

    if (isNative) {
      try {
        await meshService.sendMessage(content, receiverId);
        await multiTransportMesh.sendMessage(content, receiverId);
      } catch (err) {
        console.error('[MeshNetwork] Native send error:', err);
      }
    }
  }, [localDeviceId]);

  const sendTypingIndicator = useCallback(async (receiverId: string, isTyping: boolean) => {
    // Via local mesh (works offline)
    localMesh.sendTypingIndicator(receiverId, isTyping);

    // Via cloud if online
    if (isOnline) {
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
    }
  }, [localDeviceId, isOnline]);

  const refreshDevice = useCallback(async (deviceId: string) => {
    await syncWithCloud(deviceIdRef.current, localDeviceName);
  }, [syncWithCloud, localDeviceName]);

  const retryMessage = useCallback(async (messageId: string) => {
    const message = messages.find(m => m.id === messageId);
    if (!message || message.status !== 'failed') return;

    setMessages(prev =>
      prev.map(m => m.id === messageId ? { ...m, status: 'sending', retryCount: (m.retryCount || 0) + 1 } : m)
    );

    // Try local mesh
    try {
      await localMesh.sendMessage(message.content, message.receiverId);
    } catch (err) {
      console.log('[MeshNetwork] Local retry failed:', err);
    }

    // Try cloud
    const hasNetwork = await checkNetworkConnectivity();
    if (hasNetwork) {
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
        await offlineStorage.markMessageSynced(messageId);
      } catch (err) {
        setMessages(prev => prev.map(m => m.id === messageId ? { ...m, status: 'failed' } : m));
      }
    } else {
      // Mark as queued
      setMessages(prev => prev.map(m => m.id === messageId ? { ...m, status: 'queued' } : m));
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
    isOnline,
    typingUsers,
    startScanning,
    stopScanning,
    sendMessage,
    sendTypingIndicator,
    refreshDevice,
    retryMessage,
  };
};
