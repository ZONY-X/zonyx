-- Add time fields for pickup and dropoff
ALTER TABLE public.bookings
ADD COLUMN pickup_time TIME,
ADD COLUMN dropoff_time TIME;

-- Update Jimmy's Cybertruck booking with correct dates and times
UPDATE public.bookings
SET 
  start_date = '2026-01-03',
  end_date = '2026-01-04',
  pickup_time = '20:30',
  dropoff_time = '12:00'
WHERE id = '19cebca1-1abf-4a31-a841-664f49f1be50';