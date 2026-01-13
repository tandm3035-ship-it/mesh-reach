import { useState, useRef, useEffect } from 'react';
import { MeshDevice, MeshMessage } from '@/types/mesh';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { EmojiPicker } from '@/components/EmojiPicker';
import { 
  Send, 
  ArrowLeft, 
  Phone, 
  Video, 
  MoreVertical, 
  Check, 
  CheckCheck,
  Clock,
  X,
  Image as ImageIcon,
  Paperclip,
  Mic,
  Smartphone,
  Tablet,
  Laptop,
  Monitor
} from 'lucide-react';
import { formatDistanceToNow, format, isToday, isYesterday } from 'date-fns';
import { cn } from '@/lib/utils';

interface ChatInterfaceProps {
  device: MeshDevice;
  messages: MeshMessage[];
  localDeviceId: string;
  onSendMessage: (content: string, receiverId: string) => void;
  onBack: () => void;
  onTyping?: (isTyping: boolean) => void;
}

const MessageStatus = ({ status }: { status: MeshMessage['status'] }) => {
  switch (status) {
    case 'sending':
      return <Clock className="w-3.5 h-3.5 text-muted-foreground" />;
    case 'sent':
      return <Check className="w-3.5 h-3.5 text-muted-foreground" />;
    case 'delivered':
      return <CheckCheck className="w-3.5 h-3.5 text-muted-foreground" />;
    case 'read':
      return <CheckCheck className="w-3.5 h-3.5 text-primary" />;
    case 'failed':
      return <X className="w-3.5 h-3.5 text-destructive" />;
    default:
      return null;
  }
};

const formatMessageTime = (date: Date) => {
  if (isToday(date)) {
    return format(date, 'HH:mm');
  }
  if (isYesterday(date)) {
    return 'Yesterday ' + format(date, 'HH:mm');
  }
  return format(date, 'dd/MM/yy HH:mm');
};

export const ChatInterface = ({ 
  device, 
  messages, 
  localDeviceId, 
  onSendMessage, 
  onBack,
  onTyping 
}: ChatInterfaceProps) => {
  const [message, setMessage] = useState('');
  const [isTypingLocal, setIsTypingLocal] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const typingTimeoutRef = useRef<NodeJS.Timeout>();

  // Filter messages for this conversation
  const conversationMessages = messages.filter(
    m => (m.senderId === device.id && m.receiverId === localDeviceId) ||
         (m.senderId === localDeviceId && m.receiverId === device.id)
  ).sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [conversationMessages.length]);

  // Focus input on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setMessage(e.target.value);
    
    // Handle typing indicator
    if (!isTypingLocal && e.target.value) {
      setIsTypingLocal(true);
      onTyping?.(true);
    }

    // Clear previous timeout
    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
    }

    // Set new timeout to stop typing
    typingTimeoutRef.current = setTimeout(() => {
      setIsTypingLocal(false);
      onTyping?.(false);
    }, 2000);
  };

  const handleSend = () => {
    if (!message.trim()) return;
    
    onSendMessage(message.trim(), device.id);
    setMessage('');
    setIsTypingLocal(false);
    onTyping?.(false);
    
    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // Group messages by date
  const groupedMessages: { date: string; messages: MeshMessage[] }[] = [];
  let currentDate = '';
  
  conversationMessages.forEach(msg => {
    const msgDate = format(new Date(msg.timestamp), 'yyyy-MM-dd');
    if (msgDate !== currentDate) {
      currentDate = msgDate;
      groupedMessages.push({ date: msgDate, messages: [msg] });
    } else {
      groupedMessages[groupedMessages.length - 1].messages.push(msg);
    }
  });

  const formatDateHeader = (dateStr: string) => {
    const date = new Date(dateStr);
    if (isToday(date)) return 'Today';
    if (isYesterday(date)) return 'Yesterday';
    return format(date, 'MMMM d, yyyy');
  };

  // Get device icon based on type
  const DeviceTypeIcon = () => {
    const iconClass = "w-5 h-5";
    switch (device.type) {
      case 'phone': return <Smartphone className={iconClass} />;
      case 'tablet': return <Tablet className={iconClass} />;
      case 'laptop': return <Laptop className={iconClass} />;
      case 'desktop': return <Monitor className={iconClass} />;
      default: return <Smartphone className={iconClass} />;
    }
  };

  return (
    <div className="flex flex-col h-full bg-background">
      {/* Header */}
      <div className="flex items-center gap-3 p-4 border-b border-border bg-card">
        <Button variant="ghost" size="icon" onClick={onBack} className="lg:hidden">
          <ArrowLeft className="w-5 h-5" />
        </Button>
        
        <div className="relative">
          <div className={cn(
            "w-11 h-11 rounded-full flex items-center justify-center",
            device.isOnline || device.isConnected
              ? "bg-gradient-to-br from-node-active/20 to-primary/20 text-primary border-2 border-node-active/50"
              : "bg-gradient-to-br from-muted to-secondary text-muted-foreground border-2 border-border"
          )}>
            <DeviceTypeIcon />
          </div>
          <div className={cn(
            "absolute bottom-0 right-0 w-3 h-3 rounded-full border-2 border-card",
            device.isOnline || device.isConnected ? "bg-node-active" : "bg-muted-foreground"
          )} />
        </div>
        
        <div className="flex-1 min-w-0">
          <h3 className="font-bold text-base tracking-tight truncate">{device.name}</h3>
          <p className="text-xs text-muted-foreground flex items-center gap-2">
            <span className="capitalize">{device.type}</span>
            <span>•</span>
            {device.isTyping ? (
              <span className="text-primary animate-pulse">typing...</span>
            ) : device.isOnline || device.isConnected ? (
              <span className="text-node-active font-medium">Online</span>
            ) : (
              <span>Last seen {formatDistanceToNow(device.lastSeen, { addSuffix: true })}</span>
            )}
          </p>
        </div>

        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" className="text-muted-foreground">
            <Phone className="w-5 h-5" />
          </Button>
          <Button variant="ghost" size="icon" className="text-muted-foreground">
            <Video className="w-5 h-5" />
          </Button>
          <Button variant="ghost" size="icon" className="text-muted-foreground">
            <MoreVertical className="w-5 h-5" />
          </Button>
        </div>
      </div>

      {/* Messages */}
      <ScrollArea className="flex-1 p-4" ref={scrollRef}>
        <div className="space-y-4 max-w-3xl mx-auto">
          {/* Network info */}
          <div className="flex justify-center">
            <div className="px-3 py-1.5 rounded-full bg-secondary text-xs text-muted-foreground">
              🔗 Messages travel through mesh network
            </div>
          </div>

          {groupedMessages.map((group) => (
            <div key={group.date}>
              {/* Date separator */}
              <div className="flex justify-center mb-4">
                <div className="px-3 py-1 rounded-full bg-secondary text-xs text-muted-foreground">
                  {formatDateHeader(group.date)}
                </div>
              </div>

              {/* Messages */}
              <div className="space-y-2">
                {group.messages.map((msg) => {
                  const isOwn = msg.senderId === localDeviceId;
                  
                  return (
                    <div
                      key={msg.id}
                      className={cn(
                        "flex",
                        isOwn ? "justify-end" : "justify-start"
                      )}
                    >
                      <div
                        className={cn(
                          "max-w-[80%] px-4 py-2 rounded-2xl animate-fade-in",
                          isOwn
                            ? "bg-primary text-primary-foreground rounded-br-md"
                            : "bg-secondary text-secondary-foreground rounded-bl-md"
                        )}
                      >
                        <p className="break-words">{msg.content}</p>
                        
                        {/* Hops info for delivered messages */}
                        {msg.hops && msg.hops.length > 1 && (
                          <p className={cn(
                            "text-[10px] mt-1 opacity-70",
                            isOwn ? "text-primary-foreground/70" : "text-muted-foreground"
                          )}>
                            via {msg.hops.length - 1} hop{msg.hops.length > 2 ? 's' : ''}
                          </p>
                        )}
                        
                        <div className={cn(
                          "flex items-center gap-1 justify-end mt-1",
                          isOwn ? "text-primary-foreground/70" : "text-muted-foreground"
                        )}>
                          <span className="text-[10px]">
                            {formatMessageTime(new Date(msg.timestamp))}
                          </span>
                          {isOwn && <MessageStatus status={msg.status} />}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}

          {/* Typing indicator */}
          {device.isTyping && (
            <div className="flex justify-start">
              <div className="bg-secondary px-4 py-3 rounded-2xl rounded-bl-md">
                <div className="flex gap-1">
                  <div className="w-2 h-2 bg-muted-foreground rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                  <div className="w-2 h-2 bg-muted-foreground rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                  <div className="w-2 h-2 bg-muted-foreground rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                </div>
              </div>
            </div>
          )}
        </div>
      </ScrollArea>

      {/* Input */}
      <div className="p-4 border-t border-border bg-card">
        <div className="flex items-center gap-2 max-w-3xl mx-auto">
          <EmojiPicker onEmojiSelect={(emoji) => setMessage(prev => prev + emoji)} />
          <Button variant="ghost" size="icon" className="text-muted-foreground shrink-0">
            <Paperclip className="w-5 h-5" />
          </Button>
          
          <Input
            ref={inputRef}
            value={message}
            onChange={handleInputChange}
            onKeyPress={handleKeyPress}
            placeholder="Type a message..."
            className="flex-1 bg-secondary border-0 focus-visible:ring-1 focus-visible:ring-primary"
          />
          
          {message.trim() ? (
            <Button 
              onClick={handleSend} 
              size="icon"
              className="shrink-0 bg-primary hover:bg-primary/90"
            >
              <Send className="w-5 h-5" />
            </Button>
          ) : (
            <Button variant="ghost" size="icon" className="text-muted-foreground shrink-0">
              <Mic className="w-5 h-5" />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
};
