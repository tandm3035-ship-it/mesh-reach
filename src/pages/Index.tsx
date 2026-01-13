import { useState, useEffect } from 'react';
import { useMeshNetwork } from '@/hooks/useMeshNetwork';
import { ConversationList } from '@/components/ConversationList';
import { ChatInterface } from '@/components/ChatInterface';
import { WelcomeScreen } from '@/components/WelcomeScreen';
import { TransportStatusBar } from '@/components/TransportStatusBar';
import { MeshDevice } from '@/types/mesh';
import { Toaster } from '@/components/ui/sonner';
import { toast } from 'sonner';

const Index = () => {
  const {
    devices,
    messages,
    isScanning,
    localDeviceId,
    localDeviceName,
    startScanning,
    stopScanning,
    sendMessage,
    sendTypingIndicator,
    isInitialized,
  } = useMeshNetwork();

  const [selectedDevice, setSelectedDevice] = useState<MeshDevice | null>(null);
  const [isMobileView, setIsMobileView] = useState(false);

  // Check for mobile view
  useEffect(() => {
    const checkMobile = () => setIsMobileView(window.innerWidth < 1024);
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  // Show toast for new messages
  useEffect(() => {
    const lastMessage = messages[messages.length - 1];
    if (lastMessage && 
        lastMessage.senderId !== localDeviceId && 
        lastMessage.status === 'delivered' &&
        (!selectedDevice || selectedDevice.id !== lastMessage.senderId)) {
      const sender = devices.find(d => d.id === lastMessage.senderId);
      toast.message(`New message from ${sender?.name || 'Unknown'}`, {
        description: lastMessage.content.slice(0, 50) + (lastMessage.content.length > 50 ? '...' : ''),
        action: {
          label: 'View',
          onClick: () => {
            const device = devices.find(d => d.id === lastMessage.senderId);
            if (device) setSelectedDevice(device);
          }
        }
      });
    }
  }, [messages, localDeviceId, devices, selectedDevice]);

  const handleSelectDevice = (device: MeshDevice) => {
    setSelectedDevice(device);
  };

  const handleBack = () => {
    setSelectedDevice(null);
  };

  const handleTyping = (isTyping: boolean) => {
    if (selectedDevice) {
      sendTypingIndicator(selectedDevice.id, isTyping);
    }
  };

  // Mobile: Show either list or chat
  if (isMobileView) {
    return (
      <div className="h-screen flex flex-col bg-background">
        {selectedDevice ? (
          <ChatInterface
            device={selectedDevice}
            messages={messages}
            localDeviceId={localDeviceId}
            onSendMessage={sendMessage}
            onBack={handleBack}
            onTyping={handleTyping}
          />
        ) : (
          <>
            <ConversationList
              devices={devices}
              messages={messages}
              localDeviceId={localDeviceId}
              selectedDeviceId={selectedDevice?.id}
              onSelectDevice={handleSelectDevice}
              onStartScan={startScanning}
              isScanning={isScanning}
            />
            {/* Transport Status Footer */}
            <div className="p-2 border-t border-border bg-card">
              <TransportStatusBar isScanning={isScanning} />
            </div>
          </>
        )}
        <Toaster position="top-center" />
      </div>
    );
  }

  // Desktop: Split view
  return (
    <div className="h-screen flex bg-background">
      {/* Left Sidebar - Conversations */}
      <div className="w-80 xl:w-96 shrink-0 flex flex-col">
        <ConversationList
          devices={devices}
          messages={messages}
          localDeviceId={localDeviceId}
          selectedDeviceId={selectedDevice?.id}
          onSelectDevice={handleSelectDevice}
          onStartScan={startScanning}
          isScanning={isScanning}
        />
        {/* Transport Status */}
        <div className="p-2 border-t border-border bg-card">
          <TransportStatusBar isScanning={isScanning} />
        </div>
      </div>

      {/* Right Panel - Chat or Welcome */}
      <div className="flex-1 flex flex-col">
        {selectedDevice ? (
          <ChatInterface
            device={selectedDevice}
            messages={messages}
            localDeviceId={localDeviceId}
            onSendMessage={sendMessage}
            onBack={handleBack}
            onTyping={handleTyping}
          />
        ) : (
          <WelcomeScreen
            localDeviceId={localDeviceId}
            deviceName={localDeviceName}
            onStartScan={startScanning}
            isScanning={isScanning}
          />
        )}
      </div>
      
      <Toaster position="top-right" />
    </div>
  );
};

export default Index;
