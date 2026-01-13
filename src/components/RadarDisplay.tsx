import { useEffect, useState } from 'react';
import { MeshDevice } from '@/types/mesh';
import { Smartphone, Tablet, Laptop, Monitor } from 'lucide-react';
import { cn } from '@/lib/utils';

interface RadarDisplayProps {
  devices: MeshDevice[];
  isScanning: boolean;
  onDeviceClick: (device: MeshDevice) => void;
  selectedDevice: MeshDevice | null;
}

// Device type icon with proper styling
const DeviceIcon = ({ type, isConnected }: { type: MeshDevice['type']; isConnected: boolean }) => {
  const iconClass = cn("w-5 h-5", isConnected ? "text-node-active" : "text-muted-foreground");
  switch (type) {
    case 'phone': return <Smartphone className={iconClass} />;
    case 'tablet': return <Tablet className={iconClass} />;
    case 'laptop': return <Laptop className={iconClass} />;
    case 'desktop': return <Monitor className={iconClass} />;
    default: return <Smartphone className={iconClass} />;
  }
};

// Extract short model name for radar display
const getShortModelName = (name: string): string => {
  // Remove common prefixes
  let short = name
    .replace(/^(Samsung|Apple|Google|Xiaomi|OnePlus|Huawei|OPPO|Vivo|Realme|Motorola)\s*/i, '')
    .replace(/^(Device-|MeshUser-)/i, '')
    .trim();
  
  // Truncate if too long
  if (short.length > 12) {
    short = short.substring(0, 10) + '..';
  }
  
  return short || name.substring(0, 8);
};

export const RadarDisplay = ({ devices, isScanning, onDeviceClick, selectedDevice }: RadarDisplayProps) => {
  const [rotation, setRotation] = useState(0);

  useEffect(() => {
    if (!isScanning) return;
    
    const interval = setInterval(() => {
      setRotation(prev => (prev + 2) % 360);
    }, 50);

    return () => clearInterval(interval);
  }, [isScanning]);

  return (
    <div className="relative w-full aspect-square max-w-md mx-auto">
      {/* Radar background */}
      <div className="absolute inset-0 rounded-full border-2 border-primary/30 bg-gradient-to-br from-secondary/50 to-background">
        {/* Concentric circles */}
        {[25, 50, 75].map((size) => (
          <div
            key={size}
            className="absolute rounded-full border border-primary/20"
            style={{
              width: `${size}%`,
              height: `${size}%`,
              top: `${(100 - size) / 2}%`,
              left: `${(100 - size) / 2}%`,
            }}
          />
        ))}

        {/* Cross lines */}
        <div className="absolute top-1/2 left-0 right-0 h-px bg-primary/20" />
        <div className="absolute left-1/2 top-0 bottom-0 w-px bg-primary/20" />

        {/* Radar sweep */}
        {isScanning && (
          <div
            className="absolute top-1/2 left-1/2 origin-left h-px w-1/2"
            style={{
              transform: `rotate(${rotation}deg)`,
              background: 'linear-gradient(90deg, hsl(var(--primary)), transparent)',
            }}
          >
            <div
              className="absolute top-0 left-0 w-full h-12 -translate-y-1/2"
              style={{
                background: `linear-gradient(${rotation + 90}deg, hsl(var(--primary) / 0.3), transparent)`,
              }}
            />
          </div>
        )}

        {/* Center point */}
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2">
          <div className="w-4 h-4 rounded-full bg-primary animate-glow-pulse" />
          <div className="absolute inset-0 rounded-full bg-primary/50 animate-ping" />
        </div>

        {/* Device nodes */}
        {devices.map((device) => {
          const radius = (device.distance / 100) * 45 + 10;
          const x = 50 + radius * Math.cos((device.angle * Math.PI) / 180);
          const y = 50 + radius * Math.sin((device.angle * Math.PI) / 180);
          const shortName = getShortModelName(device.name);
          const isOnline = device.isConnected || device.isOnline;

          return (
            <button
              key={device.id}
              onClick={() => onDeviceClick(device)}
              className={`absolute -translate-x-1/2 -translate-y-1/2 transition-all duration-300 group ${
                selectedDevice?.id === device.id ? 'z-20' : 'z-10'
              }`}
              style={{ left: `${x}%`, top: `${y}%` }}
            >
              {/* Signal ring */}
              {isOnline && (
                <div className="absolute inset-0 -m-2 rounded-full border border-node-active/50 animate-signal" />
              )}
              
              {/* Node container */}
              <div className="flex flex-col items-center">
                {/* Device icon */}
                <div
                  className={cn(
                    "w-11 h-11 rounded-full flex items-center justify-center transition-all duration-300",
                    isOnline
                      ? "bg-node-active/20 border-2 border-node-active shadow-lg shadow-node-active/20"
                      : "bg-muted/50 border-2 border-muted-foreground/30",
                    selectedDevice?.id === device.id
                      ? "scale-125 ring-2 ring-primary ring-offset-2 ring-offset-background"
                      : "hover:scale-110"
                  )}
                >
                  <DeviceIcon type={device.type} isConnected={isOnline} />
                </div>

                {/* Device name label */}
                <div className={cn(
                  "mt-1 px-2 py-0.5 rounded-full text-[10px] font-bold tracking-wide whitespace-nowrap",
                  isOnline
                    ? "bg-node-active/90 text-background"
                    : "bg-muted text-muted-foreground"
                )}>
                  {shortName}
                </div>
              </div>

              {/* Detailed tooltip on hover */}
              <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-3 px-3 py-2 bg-card border border-border rounded-lg shadow-lg opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none min-w-[120px]">
                <p className="font-bold text-sm text-foreground truncate">{device.name}</p>
                <p className="text-xs text-muted-foreground capitalize">{device.type}</p>
                <div className="flex items-center gap-2 mt-1 text-xs">
                  <span className={cn(
                    "px-1.5 py-0.5 rounded font-medium",
                    device.connectionType === 'bluetooth' ? "bg-blue-500/20 text-blue-400" :
                    device.connectionType === 'wifi' ? "bg-green-500/20 text-green-400" :
                    device.connectionType === 'webrtc' ? "bg-purple-500/20 text-purple-400" :
                    "bg-muted text-muted-foreground"
                  )}>
                    {device.connectionType?.toUpperCase() || 'MESH'}
                  </span>
                  <span className="text-muted-foreground">{device.signalStrength}%</span>
                </div>
              </div>
            </button>
          );
        })}
      </div>

      {/* Scanning indicator */}
      {isScanning && (
        <div className="absolute -bottom-8 left-1/2 -translate-x-1/2 flex items-center gap-2 text-primary text-sm font-medium">
          <div className="w-2 h-2 rounded-full bg-primary animate-pulse" />
          Scanning for devices...
        </div>
      )}
    </div>
  );
};
