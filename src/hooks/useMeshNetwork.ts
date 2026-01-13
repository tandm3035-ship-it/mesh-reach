import { useState, useEffect, useCallback } from 'react';
import { MeshDevice, MeshMessage } from '@/types/mesh';

const generateDeviceId = () => Math.random().toString(36).substring(2, 10).toUpperCase();

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
});

export const useMeshNetwork = () => {
  const [devices, setDevices] = useState<MeshDevice[]>([]);
  const [messages, setMessages] = useState<MeshMessage[]>([]);
  const [isScanning, setIsScanning] = useState(false);
  const [localDeviceId] = useState(generateDeviceId());

  const startScanning = useCallback(() => {
    setIsScanning(true);
    
    // Simulate discovering devices over time
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

    return () => clearInterval(discoveryInterval);
  }, []);

  const stopScanning = useCallback(() => {
    setIsScanning(false);
  }, []);

  const sendMessage = useCallback((content: string, receiverId: string) => {
    const connectedDevices = devices.filter(d => d.isConnected);
    const hops = connectedDevices
      .slice(0, Math.floor(Math.random() * 3) + 1)
      .map(d => d.id);

    const newMessage: MeshMessage = {
      id: generateDeviceId(),
      content,
      senderId: localDeviceId,
      receiverId,
      timestamp: new Date(),
      hops,
      status: 'sending',
    };

    setMessages(prev => [...prev, newMessage]);

    // Simulate message delivery
    setTimeout(() => {
      setMessages(prev =>
        prev.map(m =>
          m.id === newMessage.id
            ? { ...m, status: Math.random() > 0.1 ? 'delivered' : 'failed' }
            : m
        )
      );
    }, 1500 + hops.length * 500);
  }, [devices, localDeviceId]);

  const refreshDevice = useCallback((deviceId: string) => {
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
  }, []);

  // Update device statuses periodically
  useEffect(() => {
    const interval = setInterval(() => {
      setDevices(prev =>
        prev.map(d => ({
          ...d,
          signalStrength: Math.max(20, Math.min(100, d.signalStrength + (Math.random() - 0.5) * 10)),
          isConnected: d.signalStrength > 30 ? (Math.random() > 0.1) : false,
        }))
      );
    }, 3000);

    return () => clearInterval(interval);
  }, []);

  return {
    devices,
    messages,
    isScanning,
    localDeviceId,
    startScanning,
    stopScanning,
    sendMessage,
    refreshDevice,
  };
};
