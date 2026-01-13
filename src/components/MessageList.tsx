import { MeshMessage, MeshDevice } from '@/types/mesh';
import { Check, CheckCheck, X, ArrowRight } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';

interface MessageListProps {
  messages: MeshMessage[];
  devices: MeshDevice[];
  localDeviceId: string;
}

const StatusIcon = ({ status }: { status: MeshMessage['status'] }) => {
  switch (status) {
    case 'sending':
      return (
        <div className="w-4 h-4 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
      );
    case 'delivered':
      return <CheckCheck className="w-4 h-4 text-node-active" />;
    case 'failed':
      return <X className="w-4 h-4 text-node-inactive" />;
  }
};

export const MessageList = ({ messages, devices, localDeviceId }: MessageListProps) => {
  const getDeviceName = (id: string) => {
    if (id === localDeviceId) return 'You';
    return devices.find(d => d.id === id)?.name || id.slice(0, 8);
  };

  if (messages.length === 0) {
    return (
      <div className="h-full flex items-center justify-center text-muted-foreground">
        <div className="text-center">
          <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-muted/50 flex items-center justify-center">
            <ArrowRight className="w-8 h-8 opacity-50" />
          </div>
          <p>No messages yet</p>
          <p className="text-sm mt-1">Select a device and send a message</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4 p-4">
      {messages.map((message) => (
        <div
          key={message.id}
          className="p-4 rounded-xl bg-secondary/50 border border-border animate-fade-in"
        >
          {/* Header */}
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2 text-sm">
              <span className="text-primary font-medium">{getDeviceName(message.senderId)}</span>
              <ArrowRight className="w-4 h-4 text-muted-foreground" />
              <span className="text-accent font-medium">{getDeviceName(message.receiverId)}</span>
            </div>
            <StatusIcon status={message.status} />
          </div>

          {/* Content */}
          <p className="text-foreground mb-3">{message.content}</p>

          {/* Hops visualization */}
          {message.hops.length > 0 && (
            <div className="mb-3 p-2 rounded-lg bg-muted/50 border border-border/50">
              <p className="text-xs text-muted-foreground mb-2">Route ({message.hops.length} hops):</p>
              <div className="flex items-center gap-1 flex-wrap">
                <span className="px-2 py-1 rounded bg-primary/20 text-primary text-xs">You</span>
                {message.hops.map((hopId, i) => (
                  <div key={hopId} className="flex items-center gap-1">
                    <ArrowRight className="w-3 h-3 text-muted-foreground" />
                    <span className="px-2 py-1 rounded bg-muted text-muted-foreground text-xs">
                      {getDeviceName(hopId)}
                    </span>
                  </div>
                ))}
                <ArrowRight className="w-3 h-3 text-muted-foreground" />
                <span className="px-2 py-1 rounded bg-accent/20 text-accent text-xs">
                  {getDeviceName(message.receiverId)}
                </span>
              </div>
            </div>
          )}

          {/* Footer */}
          <div className="text-xs text-muted-foreground">
            {formatDistanceToNow(message.timestamp, { addSuffix: true })}
          </div>
        </div>
      ))}
    </div>
  );
};
