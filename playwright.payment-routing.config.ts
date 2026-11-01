import {defineConfig} from '@playwright/test';
import base from './playwright.square.config';
export default defineConfig({...base,testMatch:['payment-routing.spec.ts','square.spec.ts']});
