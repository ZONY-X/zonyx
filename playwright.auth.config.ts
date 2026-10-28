import {defineConfig} from '@playwright/test';
import base from './playwright.square.config';
export default defineConfig({...base,testMatch:['auth-verification.spec.ts'],projects:[{name:'chromium',use:{browserName:'chromium'}},{name:'webkit',use:{browserName:'webkit',launchOptions:{}}}],use:{...base.use,baseURL:'http://127.0.0.1:43878'},webServer:{command:'npm run dev -- --host 127.0.0.1 --port 43878 --strictPort',url:'http://127.0.0.1:43878',reuseExistingServer:false,env:{VITE_SUPABASE_URL:'https://auth-fixture.supabase.co',VITE_SUPABASE_PUBLISHABLE_KEY:'synthetic-test-publishable-key'}}});
