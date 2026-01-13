import { useState, useEffect, useCallback, useRef } from 'react';
import { MeshDevice, MeshMessage, ConnectionType } from '@/types/mesh';
import { meshService } from '@/services/BluetoothMeshService';
import { networkFallback, offlineQueue, NetworkStatusInfo } from '@/services/NetworkFallbackService';
import { multiTransportMesh } from '@/services/MultiTransportMesh';
import { webRTCMesh } from '@/services/WebRTCMeshService';
import { nearbyConnections } from '@/services/NearbyConnectionsService';
import { Capacitor } from '@capacitor/core';
import { Preferences } from '@capacitor/preferences';

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

// Generate mock device for web simulation
const generateMockDevice = (index: number): MeshDevice => ({
  id: generateDeviceId(),
  name: deviceNames[index % deviceNames.length],
  signalStrength: Math.floor(Math.random() * 60) + 40,
  distance: Math.floor(Math.random() * 50) + 5,
  angle: (index * 60 + Math.random() * 30) % 360,
  isConnected: Math.random() > 0.3,
  isOnline: Math.random() > 0.4,
  lastSeen: new Date(),
  type: deviceTypes[Math.floor(Math.random() * deviceTypes.length)],
  connectionType: ['bluetooth', 'wifi', 'webrtc', 'network'][Math.floor(Math.random() * 4)] as ConnectionType,
  bluetoothEnabled: true,
  isTyping: false,
  isSelf: false
});

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

  // Initialize the mesh network services
  useEffect(() => {
    if (initializationRef.current) return;
    initializationRef.current = true;

    const initializeMesh = async () => {
      try {
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

        setLocalDeviceId(deviceId);
        setLocalDeviceName(deviceName);

        // Initialize core mesh service
        await multiTransportMesh.initialize();

        // Add self as a device (for messaging yourself feature)
        const selfDevice: MeshDevice = {
          id: deviceId,
          name: deviceName,
          signalStrength: 100,
          distance: 0,
          angle: 0,
          isConnected: true,
          isOnline: true,
          lastSeen: new Date(),
          type: 'phone',
          connectionType: 'network',
          bluetoothEnabled: true,
          isSelf: true
        };
        setDevices([selfDevice]);

        // Set up event handlers
        multiTransportMesh.setEventHandler('onDeviceDiscovered', (device) => {
          setDevices(prev => {
            if (prev.find(d => d.id === device.id)) return prev;
            return [...prev, { ...device, isOnline: device.isConnected }];
          });
        });

        multiTransportMesh.setEventHandler('onDeviceUpdated', (device) => {
          setDevices(prev => prev.map(d => d.id === device.id ? { ...d, ...device } : d));
        });

        multiTransportMesh.setEventHandler('onDeviceLost', (deviceId) => {
          setDevices(prev => prev.map(d => 
            d.id === deviceId ? { ...d, isConnected: false, isOnline: false } : d
          ));
        });

        multiTransportMesh.setEventHandler('onMessageReceived', (message) => {
          setMessages(prev => {
            // Prevent duplicates
            if (prev.find(m => m.id === message.id)) return prev;
            return [...prev, message];
          });
        });

        multiTransportMesh.setEventHandler('onMessageStatusChanged', (messageId, status) => {
          setMessages(prev => prev.map(m => m.id === messageId ? { ...m, status } : m));
        });

        multiTransportMesh.setEventHandler('onScanStateChanged', (scanning) => {
          setIsScanning(scanning);
        });

        // Setup BroadcastChannel for app-to-app messaging (same origin)
        if (typeof BroadcastChannel !== 'undefined') {
          const channel = new BroadcastChannel('meshlink_messages');
          broadcastChannelRef.current = channel;

          channel.onmessage = (event) => {
            const data = event.data;
            
            if (data.from === deviceId) return; // Ignore own messages

            if (data.type === 'PRESENCE') {
              // Another app instance is online
              const peerDevice: MeshDevice = {
                id: data.from,
                name: data.name || `Device-${data.from.slice(0, 4)}`,
                signalStrength: 90,
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
              // Received a message
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

              // Send ACK
              channel.postMessage({
                type: 'ACK',
                from: deviceId,
                to: data.from,
                messageId: message.id
              });
            } else if (data.type === 'ACK' && data.to === deviceId) {
              // Message was delivered
              setMessages(prev => prev.map(m => 
                m.id === data.messageId ? { ...m, status: 'delivered' } : m
              ));
            } else if (data.type === 'TYPING' && data.to === deviceId) {
              setTypingUsers(prev => new Map(prev).set(data.from, data.isTyping));
              setDevices(prev => prev.map(d => 
                d.id === data.from ? { ...d, isTyping: data.isTyping } : d
              ));
            }
          };

          // Announce presence periodically
          const announcePresence = () => {
            channel.postMessage({
              type: 'PRESENCE',
              from: deviceId,
              name: deviceName,
              timestamp: Date.now()
            });
          };

          announcePresence();
          const presenceInterval = setInterval(announcePresence, 5000);

          // Cleanup
          return () => {
            clearInterval(presenceInterval);
            channel.close();
          };
        }

        if (isNative) {
          // Initialize Bluetooth mesh
          await meshService.initialize();
          
          // Initialize Nearby Connections
          await nearbyConnections.initialize(deviceId, deviceName);

          // Initialize network fallback
          const status = await networkFallback.initialize();
          setNetworkStatus(status);
          setConnectionMethod(status.connectionType as ConnectionType);

          networkFallback.setEventHandler('onStatusChanged', (status) => {
            setNetworkStatus(status);
          });

          // Load offline queue
          await offlineQueue.load();
          const queuedMessages = offlineQueue.getAll();
          if (queuedMessages.length > 0) {
            setMessages(prev => [...prev, ...queuedMessages]);
          }
        }

        // Initialize WebRTC
        await webRTCMesh.initialize(deviceId);

        setIsInitialized(true);
      } catch (error) {
        console.error('Failed to initialize mesh network:', error);
        setIsInitialized(true);
      }
    };

    initializeMesh();

    return () => {
      if (isNative) {
        meshService.disconnect();
        networkFallback.cleanup();
      }
      broadcastChannelRef.current?.close();
    };
  }, []);

  // Simulate device updates for web
  useEffect(() => {
    if (isNative || !isInitialized) return;

    const interval = setInterval(() => {
      setDevices(prev =>
        prev.map(d => d.isSelf ? d : ({
          ...d,
          signalStrength: Math.max(20, Math.min(100, d.signalStrength + (Math.random() - 0.5) * 10)),
          isConnected: d.signalStrength > 30 ? (Math.random() > 0.1) : false,
          isOnline: d.isConnected || (Math.random() > 0.3),
          lastSeen: d.isOnline ? new Date() : d.lastSeen
        }))
      );
    }, 5000);

    return () => clearInterval(interval);
  }, [isNative, isInitialized]);

  const startScanning = useCallback(async () => {
    if (isNative) {
      await meshService.startScan();
      multiTransportMesh.setScanning(true);
    } else {
      // Web simulation
      setIsScanning(true);
      
      let discoveredCount = 0;
      const discoveryInterval = setInterval(() => {
        setDevices(prev => {
          const nonSelfDevices = prev.filter(d => !d.isSelf);
          if (nonSelfDevices.length >= 8 || discoveredCount >= 8) {
            clearInterval(discoveryInterval);
            setIsScanning(false);
            return prev;
          }
          discoveredCount++;
          const newDevice = generateMockDevice(nonSelfDevices.length);
          return [...prev, newDevice];
        });
      }, 600);

      setTimeout(() => {
        clearInterval(discoveryInterval);
        setIsScanning(false);
      }, 8000);
    }
  }, []);

  const stopScanning = useCallback(async () => {
    if (isNative) {
      await meshService.stopScan();
      multiTransportMesh.setScanning(false);
    } else {
      setIsScanning(false);
    }
  }, []);

  const sendMessage = useCallback(async (content: string, receiverId: string) => {
    const messageId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
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

    // Handle self-message (message to yourself)
    if (receiverId === localDeviceId) {
      setTimeout(() => {
        setMessages(prev =>
          prev.map(m => m.id === messageId ? { ...m, status: 'delivered' } : m)
        );
      }, 300);
      return;
    }

    // Send via BroadcastChannel (app-to-app)
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

    if (isNative) {
      try {
        await meshService.sendMessage(content, receiverId);
        await multiTransportMesh.sendMessage(content, receiverId);
      } catch (error) {
        const queuedMessage = { ...newMessage, status: 'queued' as const };
        offlineQueue.add(queuedMessage);
        setMessages(prev =>
          prev.map(m => m.id === messageId ? queuedMessage : m)
        );
      }
    } else {
      // Web simulation - simulate delivery
      const connectedDevices = devices.filter(d => d.isConnected && !d.isSelf);
      const hops = connectedDevices
        .slice(0, Math.floor(Math.random() * 2) + 1)
        .map(d => d.id);

      setTimeout(() => {
        setMessages(prev =>
          prev.map(m =>
            m.id === messageId
              ? { 
                  ...m, 
                  status: Math.random() > 0.05 ? 'delivered' : 'sent',
                  hops: [...m.hops, ...hops]
                }
              : m
          )
        );
      }, 800 + hops.length * 300);

      // Simulate read receipt after a delay
      setTimeout(() => {
        setMessages(prev =>
          prev.map(m =>
            m.id === messageId && m.status === 'delivered'
              ? { ...m, status: 'read' }
              : m
          )
        );
      }, 3000 + Math.random() * 5000);
    }
  }, [devices, localDeviceId]);

  const sendTypingIndicator = useCallback((receiverId: string, isTyping: boolean) => {
    if (broadcastChannelRef.current) {
      broadcastChannelRef.current.postMessage({
        type: 'TYPING',
        from: localDeviceId,
        to: receiverId,
        isTyping
      });
    }
  }, [localDeviceId]);

  const refreshDevice = useCallback(async (deviceId: string) => {
    if (isNative) {
      await meshService.connectToDevice(deviceId);
    } else {
      setDevices(prev =>
        prev.map(d =>
          d.id === deviceId
            ? {
                ...d,
                signalStrength: Math.floor(Math.random() * 60) + 40,
                lastSeen: new Date(),
                isOnline: true
              }
            : d
        )
      );
    }
  }, []);

  const retryMessage = useCallback(async (messageId: string) => {
    const message = messages.find(m => m.id === messageId);
    if (!message || message.status !== 'failed') return;

    setMessages(prev =>
      prev.map(m => m.id === messageId ? { ...m, status: 'sending', retryCount: (m.retryCount || 0) + 1 } : m)
    );

    if (isNative) {
      try {
        await meshService.sendMessage(message.content, message.receiverId);
      } catch (error) {
        setMessages(prev =>
          prev.map(m => m.id === messageId ? { ...m, status: 'failed' } : m)
        );
      }
    } else {
      setTimeout(() => {
        setMessages(prev =>
          prev.map(m =>
            m.id === messageId
              ? { ...m, status: Math.random() > 0.2 ? 'delivered' : 'failed' }
              : m
          )
        );
      }, 1500);
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
