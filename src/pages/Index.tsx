import { useState } from 'react';
import { useMeshNetwork } from '@/hooks/useMeshNetwork';
import { Header } from '@/components/Header';
import { RadarDisplay } from '@/components/RadarDisplay';
import { DevicePanel } from '@/components/DevicePanel';
import { MessageList } from '@/components/MessageList';
import { MessageComposer } from '@/components/MessageComposer';
import { NetworkStats } from '@/components/NetworkStats';
import { MeshDevice } from '@/types/mesh';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Radio, MessageSquare } from 'lucide-react';

const Index = () => {
  const {
    devices,
    messages,
    isScanning,
    localDeviceId,
    startScanning,
    stopScanning,
    sendMessage,
    refreshDevice,
  } = useMeshNetwork();

  const [selectedDevice, setSelectedDevice] = useState<MeshDevice | null>(null);
  const [composingTo, setComposingTo] = useState<MeshDevice | null>(null);

  return (
    <div className="min-h-screen bg-background">
      <Header
        isScanning={isScanning}
        onStartScan={startScanning}
        onStopScan={stopScanning}
        localDeviceId={localDeviceId}
      />

      <main className="container mx-auto px-4 py-8">
        {/* Network Stats */}
        <section className="mb-8">
          <NetworkStats
            devices={devices}
            messages={messages}
            localDeviceId={localDeviceId}
          />
        </section>

        {/* Main Content Grid */}
        <div className="grid lg:grid-cols-3 gap-8">
          {/* Radar Section */}
          <div className="lg:col-span-2">
            <div className="rounded-2xl border border-border bg-card p-6">
              <div className="flex items-center gap-2 mb-6">
                <Radio className="w-5 h-5 text-primary" />
                <h2 className="font-display text-lg font-bold">Network Radar</h2>
              </div>
              <RadarDisplay
                devices={devices}
                isScanning={isScanning}
                onDeviceClick={setSelectedDevice}
                selectedDevice={selectedDevice}
              />
              
              {devices.length === 0 && !isScanning && (
                <p className="text-center text-muted-foreground mt-6">
                  Click "Scan Network" to discover nearby devices
                </p>
              )}
            </div>
          </div>

          {/* Side Panel */}
          <div className="lg:col-span-1">
            <Tabs defaultValue="device" className="h-full">
              <TabsList className="w-full mb-4">
                <TabsTrigger value="device" className="flex-1">
                  <Radio className="w-4 h-4 mr-2" />
                  Device
                </TabsTrigger>
                <TabsTrigger value="messages" className="flex-1">
                  <MessageSquare className="w-4 h-4 mr-2" />
                  Messages
                </TabsTrigger>
              </TabsList>

              <div className="rounded-2xl border border-border bg-card min-h-[400px]">
                <TabsContent value="device" className="m-0">
                  <DevicePanel
                    device={selectedDevice}
                    onRefresh={refreshDevice}
                    onSendMessage={setComposingTo}
                  />
                </TabsContent>

                <TabsContent value="messages" className="m-0">
                  <MessageList
                    messages={messages}
                    devices={devices}
                    localDeviceId={localDeviceId}
                  />
                </TabsContent>
              </div>
            </Tabs>
          </div>
        </div>

        {/* Info Section */}
        <section className="mt-12">
          <div className="rounded-2xl border border-border bg-gradient-to-br from-card to-secondary/30 p-8">
            <h2 className="font-display text-2xl font-bold mb-4 text-glow">How Mesh Messaging Works</h2>
            <div className="grid md:grid-cols-3 gap-6">
              <div className="p-4 rounded-xl bg-background/50">
                <div className="w-12 h-12 rounded-lg bg-primary/20 flex items-center justify-center mb-4">
                  <span className="font-display text-xl text-primary">1</span>
                </div>
                <h3 className="font-display font-bold mb-2">Discover Devices</h3>
                <p className="text-sm text-muted-foreground">
                  Your device scans for nearby phones using Bluetooth and WiFi Direct technology.
                </p>
              </div>
              <div className="p-4 rounded-xl bg-background/50">
                <div className="w-12 h-12 rounded-lg bg-accent/20 flex items-center justify-center mb-4">
                  <span className="font-display text-xl text-accent">2</span>
                </div>
                <h3 className="font-display font-bold mb-2">Create Network</h3>
                <p className="text-sm text-muted-foreground">
                  Connected devices form a mesh network, relaying data between each other automatically.
                </p>
              </div>
              <div className="p-4 rounded-xl bg-background/50">
                <div className="w-12 h-12 rounded-lg bg-node-active/20 flex items-center justify-center mb-4">
                  <span className="font-display text-xl text-node-active">3</span>
                </div>
                <h3 className="font-display font-bold mb-2">Send Messages</h3>
                <p className="text-sm text-muted-foreground">
                  Messages hop through intermediate devices to reach recipients far beyond direct range.
                </p>
              </div>
            </div>
          </div>
        </section>
      </main>

      {/* Message Composer Modal */}
      {composingTo && (
        <MessageComposer
          recipient={composingTo}
          onSend={sendMessage}
          onClose={() => setComposingTo(null)}
        />
      )}
    </div>
  );
};

export default Index;
