import { useState, useEffect, useCallback, useRef } from 'react';
import { MeshDevice, MeshMessage, ConnectionType } from '@/types/mesh';
import { unifiedMesh } from '@/services/UnifiedMeshService';
import { offlineStorage } from '@/services/OfflineStorageService';

export const useMeshNetwork = () => {
  const [devices, setDevices] = useState<MeshDevice[]>([]);
  const [messages, setMessages] = useState<MeshMessage[]>([]);
  const [isScanning, setIsScanning] = useState(false);
  const [localDeviceId, setLocalDeviceId] = useState('');
  const [localDeviceName, setLocalDeviceName] = useState('My Device');
  const [connectionMethod, setConnectionMethod] = useState<ConnectionType>('unknown');
  const [isInitialized, setIsInitialized] = useState(false);
  const [typingUsers, setTypingUsers] = useState<Map<string, boolean>>(new Map());
  const [isOnline, setIsOnline] = useState(false);
  const [networkStatus, setNetworkStatus] = useState<any>(null);
  
  const initializationRef = useRef(false);
  const messagesLoadedRef = useRef(false);

  // Initialize the unified mesh network
  useEffect(() => {
    if (initializationRef.current) return;
    initializationRef.current = true;

    const initializeMesh = async () => {
      try {
        console.log('[useMeshNetwork] Initializing unified mesh...');
        
        // Initialize offline storage first
        await offlineStorage.initialize();
        
        // Initialize the unified mesh service
        const { deviceId, deviceName } = await unifiedMesh.initialize();
        
        setLocalDeviceId(deviceId);
        setLocalDeviceName(deviceName);

        // Load ALL cached messages from IndexedDB immediately (works offline!)
        if (!messagesLoadedRef.current) {
          const cachedMessages = await offlineStorage.getAllMessages(deviceId);
          console.log('[useMeshNetwork] Loaded', cachedMessages.length, 'cached messages');
          setMessages(cachedMessages);
          messagesLoadedRef.current = true;
        }
        
        // Load cached devices
        const cachedDevices = await offlineStorage.getAllDevices();
        console.log('[useMeshNetwork] Loaded', cachedDevices.length, 'cached devices');
        if (cachedDevices.length > 0) {
          setDevices(cachedDevices.filter(d => !d.isSelf));
        }
        
        // Get current devices from mesh service
        const currentDevices = unifiedMesh.getDevices();
        if (currentDevices.length > 0) {
          setDevices(prev => {
            const merged = new Map(prev.map(d => [d.id, d]));
            currentDevices.forEach(d => merged.set(d.id, d));
            return Array.from(merged.values());
          });
        }
        
        setIsOnline(unifiedMesh.getIsOnline());

        // Setup event handlers
        unifiedMesh.setEventHandler('onDeviceDiscovered', (device) => {
          console.log('[useMeshNetwork] Device discovered:', device.name);
          setDevices(prev => {
            const exists = prev.find(d => d.id === device.id);
            if (exists) {
              return prev.map(d => d.id === device.id ? { ...d, ...device } : d);
            }
            return [...prev, device];
          });
        });

        unifiedMesh.setEventHandler('onDeviceUpdated', (device) => {
          setDevices(prev => prev.map(d => 
            d.id === device.id ? { ...d, ...device } : d
          ));
          
          // Handle typing indicator
          if (device.isTyping !== undefined) {
            setTypingUsers(prev => {
              const next = new Map(prev);
              if (device.isTyping) {
                next.set(device.id, true);
              } else {
                next.delete(device.id);
              }
              return next;
            });
          }
        });

        unifiedMesh.setEventHandler('onDeviceLost', (deviceId) => {
          setDevices(prev => prev.map(d => 
            d.id === deviceId ? { ...d, isOnline: false, isConnected: false } : d
          ));
        });

        unifiedMesh.setEventHandler('onMessageReceived', (message) => {
          console.log('[useMeshNetwork] Message received:', message.id);
          setMessages(prev => {
            // Check for duplicates
            if (prev.find(m => m.id === message.id)) {
              console.log('[useMeshNetwork] Duplicate message ignored:', message.id);
              return prev;
            }
            console.log('[useMeshNetwork] Adding new message to state');
            return [...prev, message];
          });
        });

        unifiedMesh.setEventHandler('onMessageStatusChanged', (messageId, status) => {
          setMessages(prev => prev.map(m => 
            m.id === messageId ? { ...m, status } : m
          ));
        });

        unifiedMesh.setEventHandler('onConnectionStatusChanged', (online, transports) => {
          setIsOnline(online);
          if (transports.length > 0) {
            setConnectionMethod(transports[0]);
          }
        });

        unifiedMesh.setEventHandler('onScanStateChanged', (scanning) => {
          setIsScanning(scanning);
        });

        setIsInitialized(true);
        console.log('[useMeshNetwork] Initialization complete!');
        
        // Auto-scan on startup
        setTimeout(() => {
          unifiedMesh.startScanning();
        }, 1000);
        
      } catch (error) {
        console.error('[useMeshNetwork] Failed to initialize:', error);
        setIsInitialized(true);
      }
    };

    initializeMesh();

    // Cleanup
    return () => {
      unifiedMesh.cleanup();
    };
  }, []);

  const startScanning = useCallback(async () => {
    console.log('[useMeshNetwork] Starting scan...');
    await unifiedMesh.startScanning();
    
    // Also get current devices immediately
    setDevices(unifiedMesh.getDevices());
  }, []);

  const stopScanning = useCallback(async () => {
    unifiedMesh.stopScanning();
  }, []);

  const sendMessage = useCallback(async (content: string, receiverId: string) => {
    console.log('[useMeshNetwork] Sending message to:', receiverId);
    
    const messageId = await unifiedMesh.sendMessage(content, receiverId);
    
    // Add to local state immediately
    const newMessage: MeshMessage = {
      id: messageId,
      content,
      senderId: localDeviceId,
      receiverId,
      timestamp: new Date(),
      hops: [localDeviceId],
      status: 'sending'
    };
    
    setMessages(prev => [...prev, newMessage]);
  }, [localDeviceId]);

  const sendTypingIndicator = useCallback(async (receiverId: string, isTyping: boolean) => {
    await unifiedMesh.sendTypingIndicator(receiverId, isTyping);
  }, []);

  const refreshDevice = useCallback(async (deviceId: string) => {
    await unifiedMesh.startScanning();
  }, []);

  const retryMessage = useCallback(async (messageId: string) => {
    const message = messages.find(m => m.id === messageId);
    if (!message || message.status !== 'failed') return;

    setMessages(prev =>
      prev.map(m => m.id === messageId ? { ...m, status: 'sending' } : m)
    );

    const success = await unifiedMesh.retryMessage(messageId, message.content, message.receiverId);
    
    if (success) {
      setMessages(prev => prev.map(m => m.id === messageId ? { ...m, status: 'sent' } : m));
    } else {
      setMessages(prev => prev.map(m => m.id === messageId ? { ...m, status: 'failed' } : m));
    }
  }, [messages]);

  const isNative = typeof navigator !== 'undefined' && 
    (navigator.userAgent.includes('Capacitor') || 
     (window as any).Capacitor?.isNativePlatform?.());

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
