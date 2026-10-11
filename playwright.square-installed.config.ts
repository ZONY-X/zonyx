import {defineConfig} from '@playwright/test';
import base from './playwright.paypal.config';
export default defineConfig({...base,testMatch:['square-installed.spec.ts'],use:{...base.use,baseURL:'http://127.0.0.1:43875'},webServer:{command:'npm run dev -- --host 127.0.0.1 --port 43875 --strictPort',url:'http://127.0.0.1:43875',reuseExistingServer:false,env:{VITE_SQUARE_INSTALLED:'true',VITE_SQUARE_CHECKOUT_ENABLED:'false',VITE_SUPABASE_URL:'https://square-fixture.supabase.co',VITE_SUPABASE_PUBLISHABLE_KEY:'synthetic-test-publishable-key'}}});
