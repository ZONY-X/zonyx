
-- Create vehicle_documents table for registration, VIN, insurance, etc.
CREATE TABLE public.vehicle_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id UUID REFERENCES public.vehicles(id) ON DELETE CASCADE NOT NULL,
  registration_number TEXT,
  plate_number TEXT,
  vin_number TEXT,
  insurance_provider TEXT,
  insurance_policy_number TEXT,
  insurance_expiry DATE,
  drivers_license_number TEXT,
  drivers_license_expiry DATE,
  ownership_document_url TEXT,
  insurance_document_url TEXT,
  registration_document_url TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL
);

-- Create host_locations table for delivery and pickup settings
CREATE TABLE public.host_locations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  host_id UUID REFERENCES public.hosts(id) ON DELETE CASCADE NOT NULL,
  home_address TEXT,
  home_city TEXT,
  home_state TEXT,
  home_zip TEXT,
  home_latitude DECIMAL(10, 8),
  home_longitude DECIMAL(11, 8),
  delivery_enabled BOOLEAN DEFAULT false,
  delivery_radius_miles INTEGER DEFAULT 10,
  delivery_fee_per_mile DECIMAL(10, 2) DEFAULT 0,
  custom_locations JSONB DEFAULT '[]'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
  UNIQUE(host_id)
);

-- Create vehicle_pricing table for daily pricing calendar
CREATE TABLE public.vehicle_pricing (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id UUID REFERENCES public.vehicles(id) ON DELETE CASCADE NOT NULL,
  date DATE NOT NULL,
  price DECIMAL(10, 2) NOT NULL,
  is_available BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
  UNIQUE(vehicle_id, date)
);

-- Create bookings table for trips
CREATE TABLE public.bookings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id UUID REFERENCES public.vehicles(id) ON DELETE CASCADE NOT NULL,
  host_id UUID REFERENCES public.hosts(id) ON DELETE CASCADE NOT NULL,
  renter_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  pickup_location TEXT,
  dropoff_location TEXT,
  total_price DECIMAL(10, 2) NOT NULL,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'active', 'completed', 'cancelled')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL
);

-- Create host_messages table
CREATE TABLE public.host_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  host_id UUID REFERENCES public.hosts(id) ON DELETE CASCADE NOT NULL,
  sender_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  booking_id UUID REFERENCES public.bookings(id) ON DELETE SET NULL,
  message TEXT NOT NULL,
  is_read BOOLEAN DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL
);

-- Enable RLS on all new tables
ALTER TABLE public.vehicle_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.host_locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vehicle_pricing ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bookings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.host_messages ENABLE ROW LEVEL SECURITY;

-- Create security definer function to check if user is a host
CREATE OR REPLACE FUNCTION public.is_host(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.hosts
    WHERE user_id = _user_id
      AND is_approved = true
  )
$$;

-- Create function to get host_id for a user
CREATE OR REPLACE FUNCTION public.get_host_id(_user_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id FROM public.hosts WHERE user_id = _user_id LIMIT 1
$$;

-- RLS Policies for vehicle_documents
CREATE POLICY "Hosts can view their vehicle documents"
ON public.vehicle_documents FOR SELECT
USING (vehicle_id IN (
  SELECT v.id FROM public.vehicles v
  WHERE v.host_id = public.get_host_id(auth.uid())
));

CREATE POLICY "Hosts can insert their vehicle documents"
ON public.vehicle_documents FOR INSERT
WITH CHECK (vehicle_id IN (
  SELECT v.id FROM public.vehicles v
  WHERE v.host_id = public.get_host_id(auth.uid())
));

CREATE POLICY "Hosts can update their vehicle documents"
ON public.vehicle_documents FOR UPDATE
USING (vehicle_id IN (
  SELECT v.id FROM public.vehicles v
  WHERE v.host_id = public.get_host_id(auth.uid())
));

CREATE POLICY "Hosts can delete their vehicle documents"
ON public.vehicle_documents FOR DELETE
USING (vehicle_id IN (
  SELECT v.id FROM public.vehicles v
  WHERE v.host_id = public.get_host_id(auth.uid())
));

-- RLS Policies for host_locations
CREATE POLICY "Hosts can view their locations"
ON public.host_locations FOR SELECT
USING (host_id = public.get_host_id(auth.uid()));

CREATE POLICY "Hosts can insert their locations"
ON public.host_locations FOR INSERT
WITH CHECK (host_id = public.get_host_id(auth.uid()));

CREATE POLICY "Hosts can update their locations"
ON public.host_locations FOR UPDATE
USING (host_id = public.get_host_id(auth.uid()));

CREATE POLICY "Hosts can delete their locations"
ON public.host_locations FOR DELETE
USING (host_id = public.get_host_id(auth.uid()));

-- RLS Policies for vehicle_pricing
CREATE POLICY "Anyone can view available vehicle pricing"
ON public.vehicle_pricing FOR SELECT
USING (true);

CREATE POLICY "Hosts can insert their vehicle pricing"
ON public.vehicle_pricing FOR INSERT
WITH CHECK (vehicle_id IN (
  SELECT v.id FROM public.vehicles v
  WHERE v.host_id = public.get_host_id(auth.uid())
));

CREATE POLICY "Hosts can update their vehicle pricing"
ON public.vehicle_pricing FOR UPDATE
USING (vehicle_id IN (
  SELECT v.id FROM public.vehicles v
  WHERE v.host_id = public.get_host_id(auth.uid())
));

CREATE POLICY "Hosts can delete their vehicle pricing"
ON public.vehicle_pricing FOR DELETE
USING (vehicle_id IN (
  SELECT v.id FROM public.vehicles v
  WHERE v.host_id = public.get_host_id(auth.uid())
));

-- RLS Policies for bookings
CREATE POLICY "Hosts can view their bookings"
ON public.bookings FOR SELECT
USING (host_id = public.get_host_id(auth.uid()));

CREATE POLICY "Renters can view their bookings"
ON public.bookings FOR SELECT
USING (renter_id = auth.uid());

CREATE POLICY "Authenticated users can create bookings"
ON public.bookings FOR INSERT
WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Hosts can update their bookings"
ON public.bookings FOR UPDATE
USING (host_id = public.get_host_id(auth.uid()));

-- RLS Policies for host_messages
CREATE POLICY "Hosts can view their messages"
ON public.host_messages FOR SELECT
USING (host_id = public.get_host_id(auth.uid()) OR sender_id = auth.uid());

CREATE POLICY "Users can send messages to hosts"
ON public.host_messages FOR INSERT
WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Hosts can update message read status"
ON public.host_messages FOR UPDATE
USING (host_id = public.get_host_id(auth.uid()));

-- Create triggers for updated_at
CREATE TRIGGER update_vehicle_documents_updated_at
BEFORE UPDATE ON public.vehicle_documents
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_host_locations_updated_at
BEFORE UPDATE ON public.host_locations
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_vehicle_pricing_updated_at
BEFORE UPDATE ON public.vehicle_pricing
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_bookings_updated_at
BEFORE UPDATE ON public.bookings
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
