import {defineConfig} from '@playwright/test';
import base from './playwright.paypal.config';
export default defineConfig({...base,testMatch:['paypal-vault-checkout.spec.ts']});
