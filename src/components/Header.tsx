import { Radio, Github } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Bluetooth, Wifi, WifiOff } from 'lucide-react';

interface HeaderProps {
  isScanning: boolean;
  onStartScan: () => void;
  onStopScan: () => void;
  localDeviceId: string;
}

export const Header = ({ isScanning, onStartScan, onStopScan, localDeviceId }: HeaderProps) => {
  return (
    <header className="border-b border-border bg-card/50 backdrop-blur-sm sticky top-0 z-40">
      <div className="container mx-auto px-4 py-4">
        <div className="flex items-center justify-between">
          {/* Logo */}
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-primary to-accent flex items-center justify-center box-glow">
              <Radio className="w-6 h-6 text-primary-foreground" />
            </div>
            <div>
              <h1 className="font-display text-xl font-bold text-glow">MeshLink</h1>
              <p className="text-xs text-muted-foreground font-mono">Decentralized Messaging</p>
            </div>
          </div>

          {/* Device ID & Actions */}
          <div className="flex items-center gap-4">
            <div className="hidden sm:block text-right">
              <p className="text-xs text-muted-foreground">Your Device ID</p>
              <p className="font-mono text-sm text-primary">{localDeviceId}</p>
            </div>
            
            <Button
              onClick={isScanning ? onStopScan : onStartScan}
              className={isScanning ? 'animate-pulse' : ''}
            >
              {isScanning ? (
                <>
                  <div className="w-4 h-4 mr-2 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full animate-spin" />
                  Scanning...
                </>
              ) : (
                <>
                  <Radio className="w-4 h-4 mr-2" />
                  Scan Network
                </>
              )}
            </Button>
          </div>
        </div>
      </div>
    </header>
  );
};
