import { MeshDevice, MeshMessage } from '@/types/mesh';
import { Radio, Wifi, Send, ArrowRightLeft } from 'lucide-react';

interface NetworkStatsProps {
  devices: MeshDevice[];
  messages: MeshMessage[];
  localDeviceId: string;
}

export const NetworkStats = ({ devices, messages, localDeviceId }: NetworkStatsProps) => {
  const connectedDevices = devices.filter(d => d.isConnected).length;
  const deliveredMessages = messages.filter(m => m.status === 'delivered').length;
  const totalHops = messages.reduce((acc, m) => acc + m.hops.length, 0);

  const stats = [
    {
      icon: Radio,
      label: 'Devices Found',
      value: devices.length,
      color: 'text-primary',
      bgColor: 'bg-primary/20',
    },
    {
      icon: Wifi,
      label: 'Connected',
      value: connectedDevices,
      color: 'text-node-active',
      bgColor: 'bg-node-active/20',
    },
    {
      icon: Send,
      label: 'Messages Sent',
      value: deliveredMessages,
      color: 'text-accent',
      bgColor: 'bg-accent/20',
    },
    {
      icon: ArrowRightLeft,
      label: 'Total Hops',
      value: totalHops,
      color: 'text-yellow-500',
      bgColor: 'bg-yellow-500/20',
    },
  ];

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      {stats.map((stat) => (
        <div
          key={stat.label}
          className="p-4 rounded-xl bg-card border border-border hover:border-primary/50 transition-colors"
        >
          <div className={`w-10 h-10 rounded-lg ${stat.bgColor} flex items-center justify-center mb-3`}>
            <stat.icon className={`w-5 h-5 ${stat.color}`} />
          </div>
          <p className="font-display text-2xl font-bold">{stat.value}</p>
          <p className="text-sm text-muted-foreground">{stat.label}</p>
        </div>
      ))}
    </div>
  );
};
