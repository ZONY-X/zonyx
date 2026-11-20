import {createClient} from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import {PayPalClient} from './_shared/paypal-client.ts';
import {standaloneService,standaloneHttp,supabaseLinkStore} from './_shared/standalone-paypal-link.ts';
const LIVE='https://fazzuetfwwfiqehpnjky.supabase.co';
if(Deno.env.get('SUPABASE_URL')!==LIVE||Deno.env.get('PAYPAL_ENVIRONMENT')!=='live')throw Error('Existing ZONYX LIVE PayPal account required.');
const settings:Record<string,string>={STANDALONE_PAYPAL_LINKS_ENABLED:'true',STANDALONE_PAYPAL_CAPTURE_ENABLED:'true',STANDALONE_PAYPAL_LIVE_APPROVED:'true'};
const env=(n:string)=>settings[n]??Deno.env.get(n);
const db=createClient(LIVE,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false,autoRefreshToken:false}});
const store=supabaseLinkStore(db),id='d90b335a-0efc-450c-a45b-f42d2a8ffd7d';
const scoped={...store,byToken:async(hash:string)=>{const p=await store.byToken(hash);return p?.id===id?p:null;},byId:async(value:string)=>value===id?store.byId(value):null};
Deno.serve(standaloneHttp(standaloneService(scoped,env,()=>new PayPalClient(env))));

