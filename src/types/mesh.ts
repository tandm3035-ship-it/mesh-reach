export type ConnectionType = 'bluetooth' | 'wifi' | 'network' | 'webrtc' | 'unknown';

export interface MeshDevice {
  id: string;
  name: string;
  signalStrength: number; // 0-100
  distance: number; // meters
  angle: number; // degrees for positioning
  isConnected: boolean;
  lastSeen: Date;
  type: 'phone' | 'tablet' | 'laptop' | 'desktop' | 'unknown';
  connectionType?: ConnectionType;
  bluetoothEnabled?: boolean;
  isOnline?: boolean;
  isTyping?: boolean;
  isSelf?: boolean;
  avatar?: string;
  status?: 'online' | 'offline' | 'away';
  unreadCount?: number;
  lastMessage?: string;
  lastMessageTime?: Date;
}

export interface MeshMessage {
  id: string;
  content: string;
  senderId: string;
  receiverId: string;
  timestamp: Date;
  hops: string[]; // device IDs the message traveled through
  status: 'sending' | 'sent' | 'delivered' | 'read' | 'failed' | 'queued';
  retryCount?: number;
  type?: 'text' | 'image' | 'file' | 'system';
  replyTo?: string;
}

export interface Conversation {
  id: string;
  peerId: string;
  peerName: string;
  peerAvatar?: string;
  lastMessage?: MeshMessage;
  unreadCount: number;
  isOnline: boolean;
  isTyping: boolean;
  messages: MeshMessage[];
}

export interface MeshNetwork {
  devices: MeshDevice[];
  messages: MeshMessage[];
  conversations: Conversation[];
  isScanning: boolean;
  localDeviceId: string;
  connectionMethod: ConnectionType;
  isBluetoothEnabled: boolean;
  isWifiEnabled: boolean;
}
