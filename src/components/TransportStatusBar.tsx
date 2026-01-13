import { cn } from '@/lib/utils';
import { 
  Bluetooth, 
  Wifi, 
  Globe, 
  Radio,
  Nfc,
  Signal,
  SignalHigh,
  SignalLow,
  SignalMedium
} from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

interface TransportStatus {
  type: 'bluetooth' | 'wifi-direct' | 'webrtc' | 'network' | 'nfc';
  available: boolean;
  enabled: boolean;
  devices: number;
  label: string;
}

interface TransportStatusBarProps {
  statuses?: TransportStatus[];
  isScanning?: boolean;
}

const defaultStatuses: TransportStatus[] = [
  { type: 'bluetooth', available: true, enabled: true, devices: 0, label: 'Bluetooth LE' },
  { type: 'wifi-direct', available: true, enabled: true, devices: 0, label: 'WiFi Direct' },
  { type: 'webrtc', available: true, enabled: true, devices: 0, label: 'WebRTC P2P' },
  { type: 'network', available: true, enabled: true, devices: 0, label: 'Network' },
  { type: 'nfc', available: false, enabled: false, devices: 0, label: 'NFC' },
];

const TransportIcon = ({ type, className }: { type: TransportStatus['type']; className?: string }) => {
  switch (type) {
    case 'bluetooth':
      return <Bluetooth className={className} />;
    case 'wifi-direct':
      return <Wifi className={className} />;
    case 'webrtc':
      return <Globe className={className} />;
    case 'network':
      return <Signal className={className} />;
    case 'nfc':
      return <Nfc className={className} />;
    default:
      return <Radio className={className} />;
  }
};

export const TransportStatusBar = ({ 
  statuses = defaultStatuses,
  isScanning = false 
}: TransportStatusBarProps) => {
  const activeTransports = statuses.filter(s => s.enabled && s.available);
  const totalDevices = statuses.reduce((sum, s) => sum + s.devices, 0);

  return (
    <div className="flex items-center gap-2 px-3 py-2 bg-secondary/50 rounded-lg border border-border">
      {/* Scanning indicator */}
      {isScanning && (
        <div className="flex items-center gap-2 pr-2 border-r border-border">
          <div className="w-2 h-2 rounded-full bg-primary animate-pulse" />
          <span className="text-xs text-muted-foreground">Scanning</span>
        </div>
      )}

      {/* Transport icons */}
      <div className="flex items-center gap-1">
        {statuses.map((status) => (
          <Tooltip key={status.type}>
            <TooltipTrigger asChild>
              <div
                className={cn(
                  "p-1.5 rounded transition-colors",
                  status.enabled && status.available
                    ? "text-primary"
                    : "text-muted-foreground/50"
                )}
              >
                <TransportIcon type={status.type} className="w-4 h-4" />
                {status.devices > 0 && (
                  <span className="absolute -top-1 -right-1 w-3 h-3 text-[8px] bg-primary text-primary-foreground rounded-full flex items-center justify-center">
                    {status.devices}
                  </span>
                )}
              </div>
            </TooltipTrigger>
            <TooltipContent>
              <div className="text-xs">
                <p className="font-bold">{status.label}</p>
                <p className={status.enabled && status.available ? "text-node-active" : "text-muted-foreground"}>
                  {!status.available ? 'Unavailable' : status.enabled ? `Active (${status.devices} devices)` : 'Disabled'}
                </p>
              </div>
            </TooltipContent>
          </Tooltip>
        ))}
      </div>

      {/* Device count */}
      <div className="flex items-center gap-1 pl-2 border-l border-border">
        <span className="text-xs text-muted-foreground">{totalDevices}</span>
        <span className="text-xs text-muted-foreground">peers</span>
      </div>
    </div>
  );
};
