import { Button } from '@/components/ui/button';
import { Radio, MessageSquare, Wifi, Bluetooth, Globe, Shield, Zap } from 'lucide-react';

interface WelcomeScreenProps {
  localDeviceId: string;
  deviceName: string;
  onStartScan: () => void;
  isScanning: boolean;
}

export const WelcomeScreen = ({ 
  localDeviceId, 
  deviceName,
  onStartScan,
  isScanning 
}: WelcomeScreenProps) => {
  return (
    <div className="flex flex-col items-center justify-center h-full p-8 text-center">
      {/* Logo */}
      <div className="relative mb-8">
        <div className="w-24 h-24 rounded-full bg-gradient-to-br from-primary to-accent flex items-center justify-center">
          <Radio className="w-12 h-12 text-primary-foreground" />
        </div>
        <div className="absolute inset-0 rounded-full bg-primary/20 animate-ping" />
      </div>

      <h1 className="font-display text-3xl font-bold mb-2 text-glow">MeshLink</h1>
      <p className="text-muted-foreground mb-8 max-w-md">
        Decentralized messaging that works without internet. 
        Messages travel through nearby devices to reach anyone.
      </p>

      {/* Your Device Info */}
      <div className="p-4 rounded-xl bg-secondary/50 border border-border mb-8 w-full max-w-sm">
        <p className="text-xs text-muted-foreground mb-1">Your Device</p>
        <p className="font-display font-bold text-lg">{deviceName}</p>
        <p className="text-xs text-muted-foreground font-mono">{localDeviceId}</p>
      </div>

      {/* Features */}
      <div className="grid grid-cols-2 gap-4 mb-8 max-w-md">
        <div className="p-4 rounded-xl bg-card border border-border text-left">
          <Bluetooth className="w-6 h-6 text-primary mb-2" />
          <h3 className="font-display font-bold text-sm">Bluetooth Mesh</h3>
          <p className="text-xs text-muted-foreground">Connect to nearby devices via BLE</p>
        </div>
        <div className="p-4 rounded-xl bg-card border border-border text-left">
          <Wifi className="w-6 h-6 text-accent mb-2" />
          <h3 className="font-display font-bold text-sm">WiFi Direct</h3>
          <p className="text-xs text-muted-foreground">High-speed local connections</p>
        </div>
        <div className="p-4 rounded-xl bg-card border border-border text-left">
          <Globe className="w-6 h-6 text-node-active mb-2" />
          <h3 className="font-display font-bold text-sm">WebRTC P2P</h3>
          <p className="text-xs text-muted-foreground">App-to-app over internet</p>
        </div>
        <div className="p-4 rounded-xl bg-card border border-border text-left">
          <Shield className="w-6 h-6 text-primary mb-2" />
          <h3 className="font-display font-bold text-sm">End-to-End</h3>
          <p className="text-xs text-muted-foreground">Encrypted mesh routing</p>
        </div>
      </div>

      {/* CTA */}
      <Button 
        size="lg" 
        onClick={onStartScan}
        disabled={isScanning}
        className="w-full max-w-sm"
      >
        {isScanning ? (
          <>
            <div className="w-5 h-5 mr-2 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full animate-spin" />
            Scanning for devices...
          </>
        ) : (
          <>
            <Zap className="w-5 h-5 mr-2" />
            Start Scanning
          </>
        )}
      </Button>

      <p className="text-xs text-muted-foreground mt-4">
        Select a contact from the list or scan to discover new devices
      </p>
    </div>
  );
};
