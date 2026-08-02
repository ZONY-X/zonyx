-- Add explicit internal tester role flag for frontend/internal QA controls.
ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS is_internal_tester boolean NOT NULL DEFAULT false;

-- Mark the confirmed internal test profile.
UPDATE public.profiles
SET is_internal_tester = true
WHERE email = 'zoeysnp@gmail.com';
