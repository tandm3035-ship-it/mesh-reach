import { useState } from 'react';
import { MeshDevice } from '@/types/mesh';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Send, X, Radio } from 'lucide-react';

interface MessageComposerProps {
  recipient: MeshDevice;
  onSend: (content: string, receiverId: string) => void;
  onClose: () => void;
}

export const MessageComposer = ({ recipient, onSend, onClose }: MessageComposerProps) => {
  const [message, setMessage] = useState('');
  const [isSending, setIsSending] = useState(false);

  const handleSend = () => {
    if (!message.trim()) return;
    setIsSending(true);
    onSend(message, recipient.id);
    
    setTimeout(() => {
      setMessage('');
      setIsSending(false);
      onClose();
    }, 500);
  };

  return (
    <div className="fixed inset-0 bg-background/80 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-fade-in">
      <div className="w-full max-w-lg bg-card border border-border rounded-2xl shadow-2xl box-glow animate-scale-in">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-border">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-primary/20 flex items-center justify-center">
              <Radio className="w-5 h-5 text-primary" />
            </div>
            <div>
              <h3 className="font-display font-bold">Send via Mesh</h3>
              <p className="text-sm text-muted-foreground">To: {recipient.name}</p>
            </div>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="w-5 h-5" />
          </Button>
        </div>

        {/* Body */}
        <div className="p-4">
          <div className="mb-4 p-3 rounded-lg bg-secondary/50 border border-border">
            <div className="flex items-center gap-2 text-sm text-muted-foreground mb-2">
              <div className="w-2 h-2 rounded-full bg-node-active animate-pulse" />
              Message will travel through mesh network
            </div>
            <p className="text-xs text-muted-foreground">
              Your message will hop through {Math.floor(Math.random() * 3) + 1} nearby devices to reach {recipient.name}
            </p>
          </div>

          <Textarea
            placeholder="Type your message..."
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            className="min-h-32 bg-background border-border focus:border-primary resize-none"
            autoFocus
          />
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-3 p-4 border-t border-border">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleSend} disabled={!message.trim() || isSending}>
            {isSending ? (
              <>
                <div className="w-4 h-4 mr-2 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full animate-spin" />
                Sending...
              </>
            ) : (
              <>
                <Send className="w-4 h-4 mr-2" />
                Send Message
              </>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
};
