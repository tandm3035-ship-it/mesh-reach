export interface MeshDevice {
  id: string;
  name: string;
  signalStrength: number; // 0-100
  distance: number; // meters
  angle: number; // degrees for positioning
  isConnected: boolean;
  lastSeen: Date;
  type: 'phone' | 'tablet' | 'laptop' | 'unknown';
}

export interface MeshMessage {
  id: string;
  content: string;
  senderId: string;
  receiverId: string;
  timestamp: Date;
  hops: string[]; // device IDs the message traveled through
  status: 'sending' | 'delivered' | 'failed';
}

export interface MeshNetwork {
  devices: MeshDevice[];
  messages: MeshMessage[];
  isScanning: boolean;
  localDeviceId: string;
}
