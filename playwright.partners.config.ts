import {defineConfig} from '@playwright/test';
import base from './playwright.paypal.config';
export default defineConfig({...base,testMatch:['partners.spec.ts'],use:{...base.use,baseURL:process.env.PARTNERS_BASE_URL||'http://127.0.0.1:43872',launchOptions:{...base.use?.launchOptions,args:base.use?.launchOptions?.args?.filter(a=>!a.startsWith('--host-resolver-rules='))}},webServer:process.env.PARTNERS_BASE_URL?undefined:{command:"./node_modules/.bin/vite preview --host 127.0.0.1 --port 43872 --strictPort",url:"http://127.0.0.1:43872",reuseExistingServer:false}});
