import { MeshDevice } from '@/types/mesh';
import { Smartphone, Tablet, Laptop, HelpCircle, Wifi, WifiOff, RefreshCw, Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { formatDistanceToNow } from 'date-fns';

interface DevicePanelProps {
  device: MeshDevice | null;
  onRefresh: (deviceId: string) => void;
  onSendMessage: (device: MeshDevice) => void;
}

const DeviceIcon = ({ type }: { type: MeshDevice['type'] }) => {
  const iconClass = "w-8 h-8";
  switch (type) {
    case 'phone': return <Smartphone className={iconClass} />;
    case 'tablet': return <Tablet className={iconClass} />;
    case 'laptop': return <Laptop className={iconClass} />;
    default: return <HelpCircle className={iconClass} />;
  }
};

const SignalStrengthBar = ({ strength }: { strength: number }) => {
  const bars = 5;
  const filledBars = Math.ceil((strength / 100) * bars);

  return (
    <div className="flex items-end gap-1 h-6">
      {Array.from({ length: bars }).map((_, i) => (
        <div
          key={i}
          className={`w-2 rounded-sm transition-all duration-300 ${
            i < filledBars
              ? strength > 60
                ? 'bg-node-active'
                : strength > 30
                ? 'bg-yellow-500'
                : 'bg-node-inactive'
              : 'bg-muted'
          }`}
          style={{ height: `${(i + 1) * 20}%` }}
        />
      ))}
    </div>
  );
};

export const DevicePanel = ({ device, onRefresh, onSendMessage }: DevicePanelProps) => {
  if (!device) {
    return (
      <div className="h-full flex items-center justify-center text-muted-foreground">
        <div className="text-center">
          <Wifi className="w-12 h-12 mx-auto mb-4 opacity-50" />
          <p>Select a device to view details</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 animate-fade-in">
      {/* Device header */}
      <div className="flex items-start gap-4 mb-6">
        <div
          className={`p-4 rounded-xl ${
            device.isConnected
              ? 'bg-node-active/20 text-node-active'
              : 'bg-node-inactive/20 text-node-inactive'
          }`}
        >
          <DeviceIcon type={device.type} />
        </div>
        <div className="flex-1">
          <h3 className="font-display text-xl font-bold">{device.name}</h3>
          <p className="text-sm text-muted-foreground font-mono">{device.id}</p>
          <div className="flex items-center gap-2 mt-2">
            {device.isConnected ? (
              <span className="flex items-center gap-1 text-node-active text-sm">
                <Wifi className="w-4 h-4" />
                Connected
              </span>
            ) : (
              <span className="flex items-center gap-1 text-node-inactive text-sm">
                <WifiOff className="w-4 h-4" />
                Disconnected
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-2 gap-4 mb-6">
        <div className="p-4 rounded-lg bg-secondary/50 border border-border">
          <p className="text-xs text-muted-foreground mb-1">Signal Strength</p>
          <div className="flex items-center justify-between">
            <span className="font-display text-2xl font-bold">{device.signalStrength}%</span>
            <SignalStrengthBar strength={device.signalStrength} />
          </div>
        </div>
        <div className="p-4 rounded-lg bg-secondary/50 border border-border">
          <p className="text-xs text-muted-foreground mb-1">Distance</p>
          <span className="font-display text-2xl font-bold">{device.distance}m</span>
        </div>
      </div>

      {/* Last seen */}
      <div className="mb-6 p-4 rounded-lg bg-muted/50 border border-border">
        <p className="text-xs text-muted-foreground mb-1">Last Seen</p>
        <p className="text-sm">{formatDistanceToNow(device.lastSeen, { addSuffix: true })}</p>
      </div>

      {/* Actions */}
      <div className="flex gap-3">
        <Button
          variant="outline"
          className="flex-1"
          onClick={() => onRefresh(device.id)}
        >
          <RefreshCw className="w-4 h-4 mr-2" />
          Refresh
        </Button>
        <Button
          className="flex-1"
          disabled={!device.isConnected}
          onClick={() => onSendMessage(device)}
        >
          <Send className="w-4 h-4 mr-2" />
          Send Message
        </Button>
      </div>
    </div>
  );
};
