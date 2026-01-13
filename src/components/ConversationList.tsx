import { MeshDevice, MeshMessage } from '@/types/mesh';
import { formatDistanceToNow } from 'date-fns';
import { cn } from '@/lib/utils';
import { 
  Smartphone, 
  Tablet, 
  Laptop, 
  Monitor,
  HelpCircle,
  Check,
  CheckCheck,
  Clock,
  Search,
  Plus,
  Settings,
  Radio,
  Users
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useState } from 'react';

interface ConversationListProps {
  devices: MeshDevice[];
  messages: MeshMessage[];
  localDeviceId: string;
  selectedDeviceId?: string;
  onSelectDevice: (device: MeshDevice) => void;
  onStartScan: () => void;
  isScanning: boolean;
}

const DeviceIcon = ({ type, className }: { type: MeshDevice['type']; className?: string }) => {
  const iconClass = cn("w-5 h-5", className);
  switch (type) {
    case 'phone': return <Smartphone className={iconClass} />;
    case 'tablet': return <Tablet className={iconClass} />;
    case 'laptop': return <Laptop className={iconClass} />;
    case 'desktop': return <Monitor className={iconClass} />;
    default: return <HelpCircle className={iconClass} />;
  }
};

const getLastMessageStatus = (status: MeshMessage['status']) => {
  switch (status) {
    case 'sending':
      return <Clock className="w-3 h-3 text-muted-foreground" />;
    case 'sent':
      return <Check className="w-3 h-3 text-muted-foreground" />;
    case 'delivered':
    case 'read':
      return <CheckCheck className="w-3 h-3 text-muted-foreground" />;
    default:
      return null;
  }
};

export const ConversationList = ({
  devices,
  messages,
  localDeviceId,
  selectedDeviceId,
  onSelectDevice,
  onStartScan,
  isScanning
}: ConversationListProps) => {
  const [searchQuery, setSearchQuery] = useState('');

  // Get conversation data for each device
  const conversationData = devices.map(device => {
    const deviceMessages = messages.filter(
      m => (m.senderId === device.id && m.receiverId === localDeviceId) ||
           (m.senderId === localDeviceId && m.receiverId === device.id)
    ).sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

    const lastMessage = deviceMessages[0];
    const unreadCount = deviceMessages.filter(
      m => m.senderId === device.id && m.status !== 'read'
    ).length;

    return {
      device,
      lastMessage,
      unreadCount
    };
  });

  // Sort by last message time, then by online status
  const sortedConversations = conversationData.sort((a, b) => {
    // Self device always first if it exists
    if (a.device.isSelf) return -1;
    if (b.device.isSelf) return 1;
    
    // Then by last message time
    if (a.lastMessage && b.lastMessage) {
      return new Date(b.lastMessage.timestamp).getTime() - new Date(a.lastMessage.timestamp).getTime();
    }
    if (a.lastMessage) return -1;
    if (b.lastMessage) return 1;
    
    // Then by online status
    if (a.device.isConnected && !b.device.isConnected) return -1;
    if (!a.device.isConnected && b.device.isConnected) return 1;
    
    return 0;
  });

  // Filter by search
  const filteredConversations = sortedConversations.filter(
    c => c.device.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
         c.device.id.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="flex flex-col h-full bg-card border-r border-border">
      {/* Header */}
      <div className="p-4 border-b border-border">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Radio className="w-6 h-6 text-primary" />
            <h1 className="font-display text-xl font-bold">MeshLink</h1>
          </div>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="icon" onClick={onStartScan} disabled={isScanning}>
              {isScanning ? (
                <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
              ) : (
                <Users className="w-5 h-5" />
              )}
            </Button>
            <Button variant="ghost" size="icon">
              <Settings className="w-5 h-5" />
            </Button>
          </div>
        </div>

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search contacts..."
            className="pl-9 bg-secondary border-0"
          />
        </div>
      </div>

      {/* Stats */}
      <div className="px-4 py-3 border-b border-border bg-secondary/30">
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">
            {devices.filter(d => d.isConnected || d.isOnline).length} online
          </span>
          <span className="text-muted-foreground">
            {devices.length} devices
          </span>
        </div>
      </div>

      {/* Conversations */}
      <ScrollArea className="flex-1">
        {filteredConversations.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-center p-4">
            <div className="w-16 h-16 rounded-full bg-secondary flex items-center justify-center mb-4">
              <Users className="w-8 h-8 text-muted-foreground" />
            </div>
            <h3 className="font-display font-bold mb-2">No contacts yet</h3>
            <p className="text-sm text-muted-foreground mb-4">
              Scan for nearby devices to start messaging
            </p>
            <Button onClick={onStartScan} disabled={isScanning}>
              {isScanning ? 'Scanning...' : 'Scan Network'}
            </Button>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {filteredConversations.map(({ device, lastMessage, unreadCount }) => (
              <button
                key={device.id}
                onClick={() => onSelectDevice(device)}
                className={cn(
                  "w-full flex items-center gap-3 p-4 hover:bg-secondary/50 transition-colors text-left",
                  selectedDeviceId === device.id && "bg-secondary"
                )}
              >
                {/* Avatar */}
                <div className="relative shrink-0">
                  <div className={cn(
                    "w-12 h-12 rounded-full flex items-center justify-center text-lg font-bold",
                    device.isSelf 
                      ? "bg-gradient-to-br from-accent to-primary text-primary-foreground"
                      : "bg-gradient-to-br from-primary to-accent/70 text-primary-foreground"
                  )}>
                    {device.isSelf ? '📱' : device.name.charAt(0).toUpperCase()}
                  </div>
                  <div className={cn(
                    "absolute bottom-0 right-0 w-3.5 h-3.5 rounded-full border-2 border-card",
                    device.isOnline || device.isConnected || device.isSelf
                      ? "bg-node-active" 
                      : "bg-muted-foreground"
                  )} />
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-display font-bold truncate">
                      {device.isSelf ? `${device.name} (You)` : device.name}
                    </span>
                    {lastMessage && (
                      <span className="text-xs text-muted-foreground shrink-0">
                        {formatDistanceToNow(new Date(lastMessage.timestamp), { addSuffix: false })}
                      </span>
                    )}
                  </div>
                  
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1 min-w-0">
                      {lastMessage && lastMessage.senderId === localDeviceId && (
                        getLastMessageStatus(lastMessage.status)
                      )}
                      <p className="text-sm text-muted-foreground truncate">
                        {device.isTyping ? (
                          <span className="text-primary italic">typing...</span>
                        ) : lastMessage ? (
                          lastMessage.content
                        ) : device.isSelf ? (
                          'Message yourself'
                        ) : (
                          <span className="flex items-center gap-1">
                            <DeviceIcon type={device.type} className="w-3 h-3" />
                            {device.connectionType || 'Nearby'}
                          </span>
                        )}
                      </p>
                    </div>
                    
                    {unreadCount > 0 && (
                      <Badge className="ml-2 bg-primary text-primary-foreground shrink-0">
                        {unreadCount}
                      </Badge>
                    )}
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
      </ScrollArea>

      {/* Bottom Action */}
      <div className="p-4 border-t border-border">
        <Button 
          className="w-full" 
          variant="outline"
          onClick={onStartScan}
          disabled={isScanning}
        >
          <Plus className="w-4 h-4 mr-2" />
          {isScanning ? 'Scanning...' : 'Find More Devices'}
        </Button>
      </div>
    </div>
  );
};
