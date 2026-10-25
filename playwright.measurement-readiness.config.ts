import {defineConfig} from '@playwright/test';
import base from './playwright.conversions.config';
export default defineConfig({...base,testMatch:['measurement-readiness.spec.ts'],use:{...base.use,baseURL:'http://127.0.0.1:43877'},webServer:{...base.webServer,command:'npm run dev -- --host 127.0.0.1 --port 43877 --strictPort',url:'http://127.0.0.1:43877',env:{...base.webServer.env,VITE_GA4_MANUAL_EVENTS_READY:'false',VITE_GOOGLE_ADS_CONVERSION_ID:'',VITE_GOOGLE_ADS_CONVERSION_LABEL:''}}});
