import {defineConfig} from '@playwright/test';
import base from './playwright.paypal-vault.config';
export default defineConfig({...base,webServer:undefined,use:{...base.use,baseURL:process.env.ZONYX_VERIFY_URL,launchOptions:{args:['--disable-background-networking']}}});
