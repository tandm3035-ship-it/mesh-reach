export type ConnectionType = 'bluetooth' | 'wifi' | 'network' | 'unknown';

export interface MeshDevice {
  id: string;
  name: string;
  signalStrength: number; // 0-100
  distance: number; // meters
  angle: number; // degrees for positioning
  isConnected: boolean;
  lastSeen: Date;
  type: 'phone' | 'tablet' | 'laptop' | 'unknown';
  connectionType?: ConnectionType;
  bluetoothEnabled?: boolean;
}

export interface MeshMessage {
  id: string;
  content: string;
  senderId: string;
  receiverId: string;
  timestamp: Date;
  hops: string[]; // device IDs the message traveled through
  status: 'sending' | 'delivered' | 'failed' | 'queued';
  retryCount?: number;
}

export interface MeshNetwork {
  devices: MeshDevice[];
  messages: MeshMessage[];
  isScanning: boolean;
  localDeviceId: string;
  connectionMethod: ConnectionType;
  isBluetoothEnabled: boolean;
  isWifiEnabled: boolean;
}
