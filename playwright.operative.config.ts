import {defineConfig} from '@playwright/test';
import base from './playwright.paypal.config';
export default defineConfig({...base,testMatch:['current-operative-agreement.spec.ts'],use:{...base.use,baseURL:process.env.OPERATIVE_BASE_URL||'http://127.0.0.1:43871',launchOptions:{...base.use?.launchOptions,args:base.use?.launchOptions?.args?.filter(arg=>!process.env.OPERATIVE_BASE_URL||!arg.startsWith('--host-resolver-rules='))}},webServer:process.env.OPERATIVE_BASE_URL?undefined:base.webServer});
