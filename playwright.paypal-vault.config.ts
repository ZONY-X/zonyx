import {defineConfig} from '@playwright/test';
import base from './playwright.paypal-customer.config';
export default defineConfig({...base,testMatch:['paypal-vault-checkout.spec.ts']});
