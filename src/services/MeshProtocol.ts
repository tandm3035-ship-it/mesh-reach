// Mesh Protocol - Custom protocol for mesh messaging
// Message format for mesh network communication

export interface MeshPacket {
  id: string;
  type: 'DISCOVER' | 'ANNOUNCE' | 'MESSAGE' | 'ACK' | 'RELAY' | 'PING';
  senderId: string;
  originalSenderId: string;
  targetId: string;
  payload: string;
  timestamp: number;
  ttl: number; // Time to live - decrements on each hop
  hops: string[]; // Device IDs this packet traveled through
  signature: string; // Simple hash for verification
}

export const MESH_SERVICE_UUID = '12345678-1234-5678-1234-56789abcdef0';
export const MESH_CHARACTERISTIC_UUID = '12345678-1234-5678-1234-56789abcdef1';
export const MESH_NAME_PREFIX = 'MESH_';
export const MAX_TTL = 10;
export const MAX_MESSAGE_SIZE = 512;

// Generate unique device ID
export const generateDeviceId = (): string => {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let result = '';
  for (let i = 0; i < 8; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
};

// Simple hash for packet verification
export const hashPacket = (packet: Omit<MeshPacket, 'signature'>): string => {
  const str = JSON.stringify(packet);
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(16).padStart(8, '0');
};

// Create a mesh packet
export const createPacket = (
  type: MeshPacket['type'],
  senderId: string,
  targetId: string,
  payload: string,
  originalSenderId?: string
): MeshPacket => {
  const packet: Omit<MeshPacket, 'signature'> = {
    id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    type,
    senderId,
    originalSenderId: originalSenderId || senderId,
    targetId,
    payload,
    timestamp: Date.now(),
    ttl: MAX_TTL,
    hops: [senderId]
  };
  
  return {
    ...packet,
    signature: hashPacket(packet)
  };
};

// Verify packet integrity
export const verifyPacket = (packet: MeshPacket): boolean => {
  const { signature, ...rest } = packet;
  return hashPacket(rest) === signature;
};

// Encode packet to bytes for BLE transmission
export const encodePacket = (packet: MeshPacket): ArrayBuffer => {
  const json = JSON.stringify(packet);
  const encoder = new TextEncoder();
  return encoder.encode(json).buffer;
};

// Decode packet from bytes
export const decodePacket = (buffer: ArrayBuffer): MeshPacket | null => {
  try {
    const decoder = new TextDecoder();
    const json = decoder.decode(buffer);
    return JSON.parse(json) as MeshPacket;
  } catch {
    return null;
  }
};

// Check if packet should be relayed
export const shouldRelay = (packet: MeshPacket, localDeviceId: string): boolean => {
  // Don't relay if TTL exhausted
  if (packet.ttl <= 0) return false;
  
  // Don't relay our own packets
  if (packet.originalSenderId === localDeviceId) return false;
  
  // Don't relay if we've already seen this packet
  if (packet.hops.includes(localDeviceId)) return false;
  
  // Relay if target is not us
  return packet.targetId !== localDeviceId;
};

// Prepare packet for relay
export const prepareForRelay = (packet: MeshPacket, relayerId: string): MeshPacket => {
  const newPacket: Omit<MeshPacket, 'signature'> = {
    ...packet,
    senderId: relayerId,
    ttl: packet.ttl - 1,
    hops: [...packet.hops, relayerId]
  };
  
  return {
    ...newPacket,
    signature: hashPacket(newPacket)
  };
};
