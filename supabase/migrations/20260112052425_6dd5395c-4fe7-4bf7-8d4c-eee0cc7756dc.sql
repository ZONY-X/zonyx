-- Update handle_new_user function with input validation and sanitization
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  sanitized_display_name text;
BEGIN
  -- Get and sanitize display_name: trim whitespace and limit length
  sanitized_display_name := TRIM(COALESCE(NEW.raw_user_meta_data->>'display_name', NEW.email));
  
  -- Enforce maximum length of 255 characters
  IF LENGTH(sanitized_display_name) > 255 THEN
    sanitized_display_name := SUBSTRING(sanitized_display_name FROM 1 FOR 255);
  END IF;
  
  -- Remove any HTML-like tags to prevent potential XSS when rendered
  sanitized_display_name := REGEXP_REPLACE(sanitized_display_name, '<[^>]*>', '', 'g');
  
  -- Ensure display_name is not empty after sanitization
  IF sanitized_display_name = '' OR sanitized_display_name IS NULL THEN
    sanitized_display_name := NEW.email;
  END IF;

  INSERT INTO public.profiles (user_id, display_name)
  VALUES (NEW.id, sanitized_display_name);
  
  RETURN NEW;
END;
$function$;