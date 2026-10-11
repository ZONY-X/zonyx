import {defineConfig} from '@playwright/test';
import base from './playwright.paypal.config';
export default defineConfig({...base,testMatch:['square.spec.ts'],use:{...base.use,baseURL:'http://127.0.0.1:43874'},webServer:{command:'npm run dev -- --host 127.0.0.1 --port 43874 --strictPort',url:'http://127.0.0.1:43874',reuseExistingServer:false,env:{VITE_SQUARE_CHECKOUT_ENABLED:'true',VITE_PAYPAL_CUSTOMER_CHECKOUT_ENABLED:'true',VITE_SUPABASE_URL:'https://square-fixture.supabase.co',VITE_SUPABASE_PUBLISHABLE_KEY:'synthetic-test-publishable-key'}}});
