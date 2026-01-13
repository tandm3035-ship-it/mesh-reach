import { useState, useEffect, useCallback, useRef } from 'react';
import { MeshDevice, MeshMessage, ConnectionType } from '@/types/mesh';
import { meshService, BluetoothMeshService } from '@/services/BluetoothMeshService';
import { networkFallback, offlineQueue, NetworkStatusInfo } from '@/services/NetworkFallbackService';
import { Capacitor } from '@capacitor/core';

// Generate a consistent device ID for web simulation
const generateDeviceId = () => Math.random().toString(36).substring(2, 10).toUpperCase();

// Check if running on native platform
const isNative = Capacitor.isNativePlatform();

// Simulated device names for web preview
const deviceNames = [
  'Galaxy Node', 'Pixel Relay', 'iPhone Mesh', 'OnePlus Link',
  'Xiaomi Hub', 'Oppo Bridge', 'Vivo Connect', 'Samsung Beacon',
  'Motorola Point', 'Nokia Station', 'LG Gateway', 'Sony Router'
];

const deviceTypes: MeshDevice['type'][] = ['phone', 'tablet', 'laptop', 'unknown'];

const generateMockDevice = (index: number): MeshDevice => ({
  id: generateDeviceId(),
  name: deviceNames[index % deviceNames.length],
  signalStrength: Math.floor(Math.random() * 60) + 40,
  distance: Math.floor(Math.random() * 50) + 5,
  angle: (index * 60 + Math.random() * 30) % 360,
  isConnected: Math.random() > 0.3,
  lastSeen: new Date(),
  type: deviceTypes[Math.floor(Math.random() * deviceTypes.length)],
  connectionType: Math.random() > 0.5 ? 'bluetooth' : 'wifi',
  bluetoothEnabled: true
});

export const useMeshNetwork = () => {
  const [devices, setDevices] = useState<MeshDevice[]>([]);
  const [messages, setMessages] = useState<MeshMessage[]>([]);
  const [isScanning, setIsScanning] = useState(false);
  const [localDeviceId, setLocalDeviceId] = useState(generateDeviceId());
  const [connectionMethod, setConnectionMethod] = useState<ConnectionType>('unknown');
  const [networkStatus, setNetworkStatus] = useState<NetworkStatusInfo | null>(null);
  const [isInitialized, setIsInitialized] = useState(false);
  
  const initializationRef = useRef(false);

  // Initialize the mesh network services
  useEffect(() => {
    if (initializationRef.current) return;
    initializationRef.current = true;

    const initializeMesh = async () => {
      try {
        if (isNative) {
          // Initialize native Bluetooth mesh
          const success = await meshService.initialize();
          if (success) {
            setLocalDeviceId(meshService.getLocalDeviceId());
            
            // Set up event handlers
            meshService.setEventHandler('onDeviceDiscovered', (device) => {
              setDevices(prev => {
                if (prev.find(d => d.id === device.id)) return prev;
                return [...prev, device];
              });
            });

            meshService.setEventHandler('onDeviceUpdated', (device) => {
              setDevices(prev => 
                prev.map(d => d.id === device.id ? device : d)
              );
            });

            meshService.setEventHandler('onDeviceLost', (deviceId) => {
              setDevices(prev => prev.filter(d => d.id !== deviceId));
            });

            meshService.setEventHandler('onMessageReceived', (message) => {
              setMessages(prev => [...prev, message]);
            });

            meshService.setEventHandler('onMessageStatusChanged', (messageId, status) => {
              setMessages(prev => 
                prev.map(m => m.id === messageId ? { ...m, status } : m)
              );
            });

            meshService.setEventHandler('onScanStateChanged', (scanning) => {
              setIsScanning(scanning);
            });

            meshService.setEventHandler('onError', (error) => {
              console.error('Mesh error:', error);
            });
          }

          // Initialize network fallback
          const status = await networkFallback.initialize();
          setNetworkStatus(status);
          setConnectionMethod(status.connectionType as ConnectionType);

          networkFallback.setEventHandler('onStatusChanged', (status) => {
            setNetworkStatus(status);
          });

          networkFallback.setEventHandler('onMethodChanged', (method) => {
            setConnectionMethod(method as ConnectionType);
          });

          // Load offline message queue
          await offlineQueue.load();
          const queuedMessages = offlineQueue.getAll();
          if (queuedMessages.length > 0) {
            setMessages(prev => [...prev, ...queuedMessages]);
          }
        }

        setIsInitialized(true);
      } catch (error) {
        console.error('Failed to initialize mesh network:', error);
        setIsInitialized(true); // Still mark as initialized to allow web simulation
      }
    };

    initializeMesh();

    return () => {
      if (isNative) {
        meshService.disconnect();
        networkFallback.cleanup();
      }
    };
  }, []);

  // Web simulation for device updates
  useEffect(() => {
    if (isNative || !isInitialized) return;

    const interval = setInterval(() => {
      setDevices(prev =>
        prev.map(d => ({
          ...d,
          signalStrength: Math.max(20, Math.min(100, d.signalStrength + (Math.random() - 0.5) * 10)),
          isConnected: d.signalStrength > 30 ? (Math.random() > 0.1) : false,
          lastSeen: new Date()
        }))
      );
    }, 3000);

    return () => clearInterval(interval);
  }, [isNative, isInitialized]);

  const startScanning = useCallback(async () => {
    if (isNative) {
      await meshService.startScan();
    } else {
      // Web simulation
      setIsScanning(true);
      
      const discoveryInterval = setInterval(() => {
        setDevices(prev => {
          if (prev.length >= 8) {
            clearInterval(discoveryInterval);
            setIsScanning(false);
            return prev;
          }
          const newDevice = generateMockDevice(prev.length);
          return [...prev, newDevice];
        });
      }, 800);

      // Auto-stop after 10 seconds
      setTimeout(() => {
        clearInterval(discoveryInterval);
        setIsScanning(false);
      }, 10000);
    }
  }, []);

  const stopScanning = useCallback(async () => {
    if (isNative) {
      await meshService.stopScan();
    } else {
      setIsScanning(false);
    }
  }, []);

  const sendMessage = useCallback(async (content: string, receiverId: string) => {
    const messageId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    // Create message object
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

    // Add to local messages immediately
    setMessages(prev => [...prev, newMessage]);

    if (isNative) {
      try {
        // Try to send via Bluetooth mesh
        await meshService.sendMessage(content, receiverId);
      } catch (error) {
        // Queue for offline retry
        const queuedMessage = { ...newMessage, status: 'queued' as const };
        offlineQueue.add(queuedMessage);
        setMessages(prev =>
          prev.map(m => m.id === messageId ? queuedMessage : m)
        );
      }
    } else {
      // Web simulation
      const connectedDevices = devices.filter(d => d.isConnected);
      const hops = connectedDevices
        .slice(0, Math.floor(Math.random() * 3) + 1)
        .map(d => d.id);

      // Simulate message delivery
      setTimeout(() => {
        setMessages(prev =>
          prev.map(m =>
            m.id === messageId
              ? { 
                  ...m, 
                  status: Math.random() > 0.1 ? 'delivered' : 'failed',
                  hops: [...m.hops, ...hops]
                }
              : m
          )
        );
      }, 1500 + hops.length * 500);
    }
  }, [devices, localDeviceId]);

  const refreshDevice = useCallback(async (deviceId: string) => {
    if (isNative) {
      // Try to reconnect
      await meshService.connectToDevice(deviceId);
    } else {
      // Web simulation
      setDevices(prev =>
        prev.map(d =>
          d.id === deviceId
            ? {
                ...d,
                signalStrength: Math.floor(Math.random() * 60) + 40,
                lastSeen: new Date(),
              }
            : d
        )
      );
    }
  }, []);

  const retryMessage = useCallback(async (messageId: string) => {
    const message = messages.find(m => m.id === messageId);
    if (!message || message.status !== 'failed') return;

    // Update status to sending
    setMessages(prev =>
      prev.map(m => m.id === messageId ? { ...m, status: 'sending' as const, retryCount: (m.retryCount || 0) + 1 } : m)
    );

    if (isNative) {
      try {
        await meshService.sendMessage(message.content, message.receiverId);
      } catch (error) {
        setMessages(prev =>
          prev.map(m => m.id === messageId ? { ...m, status: 'failed' as const } : m)
        );
      }
    } else {
      // Web simulation
      setTimeout(() => {
        setMessages(prev =>
          prev.map(m =>
            m.id === messageId
              ? { ...m, status: Math.random() > 0.2 ? 'delivered' : 'failed' }
              : m
          )
        );
      }, 2000);
    }
  }, [messages]);

  return {
    devices,
    messages,
    isScanning,
    localDeviceId,
    connectionMethod,
    networkStatus,
    isInitialized,
    isNative,
    startScanning,
    stopScanning,
    sendMessage,
    refreshDevice,
    retryMessage,
  };
};
