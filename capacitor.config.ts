import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'app.lovable.c290b9cf5491433c91f3e538c4e7b4f7',
  appName: 'MeshConnect',
  webDir: 'dist',
  server: {
    url: 'https://c290b9cf-5491-433c-91f3-e538c4e7b4f7.lovableproject.com?forceHideBadge=true',
    cleartext: true
  },
  plugins: {
    BluetoothLe: {
      displayStrings: {
        scanning: 'Scanning for mesh devices...',
        cancel: 'Cancel',
        availableDevices: 'Available Devices',
        noDeviceFound: 'No devices found'
      }
    }
  }
};

export default config;
