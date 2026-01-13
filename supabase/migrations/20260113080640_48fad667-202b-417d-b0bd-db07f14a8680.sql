-- Create table for mesh devices/users who install the app globally
CREATE TABLE public.mesh_devices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id TEXT UNIQUE NOT NULL,
  device_name TEXT NOT NULL,
  is_online BOOLEAN DEFAULT false,
  last_seen TIMESTAMP WITH TIME ZONE DEFAULT now(),
  device_type TEXT DEFAULT 'phone',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Create table for messages between devices globally
CREATE TABLE public.mesh_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id TEXT UNIQUE NOT NULL,
  sender_id TEXT NOT NULL,
  receiver_id TEXT NOT NULL,
  content TEXT NOT NULL,
  status TEXT DEFAULT 'sent',
  hops TEXT[] DEFAULT ARRAY[]::TEXT[],
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Create table for presence (online status)
CREATE TABLE public.mesh_presence (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id TEXT UNIQUE NOT NULL REFERENCES mesh_devices(device_id) ON DELETE CASCADE,
  is_online BOOLEAN DEFAULT true,
  is_typing BOOLEAN DEFAULT false,
  typing_to TEXT,
  last_heartbeat TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Enable Row Level Security
ALTER TABLE public.mesh_devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mesh_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mesh_presence ENABLE ROW LEVEL SECURITY;

-- Public access policies (this is a mesh network - everyone can see everyone)
CREATE POLICY "Anyone can read devices" ON public.mesh_devices FOR SELECT USING (true);
CREATE POLICY "Anyone can insert devices" ON public.mesh_devices FOR INSERT WITH CHECK (true);
CREATE POLICY "Anyone can update devices" ON public.mesh_devices FOR UPDATE USING (true);

CREATE POLICY "Anyone can read messages" ON public.mesh_messages FOR SELECT USING (true);
CREATE POLICY "Anyone can send messages" ON public.mesh_messages FOR INSERT WITH CHECK (true);
CREATE POLICY "Anyone can update message status" ON public.mesh_messages FOR UPDATE USING (true);

CREATE POLICY "Anyone can read presence" ON public.mesh_presence FOR SELECT USING (true);
CREATE POLICY "Anyone can update presence" ON public.mesh_presence FOR INSERT WITH CHECK (true);
CREATE POLICY "Anyone can modify presence" ON public.mesh_presence FOR UPDATE USING (true);
CREATE POLICY "Anyone can delete presence" ON public.mesh_presence FOR DELETE USING (true);

-- Enable realtime for all tables
ALTER PUBLICATION supabase_realtime ADD TABLE public.mesh_devices;
ALTER PUBLICATION supabase_realtime ADD TABLE public.mesh_messages;
ALTER PUBLICATION supabase_realtime ADD TABLE public.mesh_presence;