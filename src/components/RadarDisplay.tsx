import { useEffect, useState } from 'react';
import { MeshDevice } from '@/types/mesh';
import { Smartphone, Tablet, Laptop, HelpCircle } from 'lucide-react';

interface RadarDisplayProps {
  devices: MeshDevice[];
  isScanning: boolean;
  onDeviceClick: (device: MeshDevice) => void;
  selectedDevice: MeshDevice | null;
}

const DeviceIcon = ({ type }: { type: MeshDevice['type'] }) => {
  const iconClass = "w-4 h-4";
  switch (type) {
    case 'phone': return <Smartphone className={iconClass} />;
    case 'tablet': return <Tablet className={iconClass} />;
    case 'laptop': return <Laptop className={iconClass} />;
    default: return <HelpCircle className={iconClass} />;
  }
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
          const radius = (device.distance / 100) * 45 + 10; // 10-55% from center
          const x = 50 + radius * Math.cos((device.angle * Math.PI) / 180);
          const y = 50 + radius * Math.sin((device.angle * Math.PI) / 180);

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
              {device.isConnected && (
                <div className="absolute inset-0 -m-2 rounded-full border border-node-active/50 animate-signal" />
              )}
              
              {/* Node */}
              <div
                className={`w-10 h-10 rounded-full flex items-center justify-center transition-all duration-300 ${
                  device.isConnected
                    ? 'bg-node-active/20 border-2 border-node-active node-glow'
                    : 'bg-node-inactive/20 border-2 border-node-inactive/50'
                } ${
                  selectedDevice?.id === device.id
                    ? 'scale-125 ring-2 ring-primary ring-offset-2 ring-offset-background'
                    : 'hover:scale-110'
                }`}
              >
                <DeviceIcon type={device.type} />
              </div>

              {/* Signal strength indicator */}
              <div
                className="absolute -bottom-1 left-1/2 -translate-x-1/2 h-1 rounded-full bg-primary/50"
                style={{ width: `${device.signalStrength}%`, maxWidth: '40px' }}
              />

              {/* Tooltip */}
              <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2 py-1 bg-card border border-border rounded text-xs whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
                {device.name}
              </div>
            </button>
          );
        })}
      </div>

      {/* Scanning indicator */}
      {isScanning && (
        <div className="absolute -bottom-8 left-1/2 -translate-x-1/2 flex items-center gap-2 text-primary text-sm">
          <div className="w-2 h-2 rounded-full bg-primary animate-pulse" />
          Scanning for devices...
        </div>
      )}
    </div>
  );
};
