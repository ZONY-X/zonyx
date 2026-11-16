import {createClient} from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import {existingPayPalRedirect} from '../_shared/existing-paypal-redirect.ts';
const LIVE='https://fazzuetfwwfiqehpnjky.supabase.co';
if(Deno.env.get('SUPABASE_URL')!==LIVE)throw Error('Existing hosted LIVE link is restricted to ZONYX production.');
Deno.serve(existingPayPalRedirect(createClient(LIVE,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false,autoRefreshToken:false}})));
