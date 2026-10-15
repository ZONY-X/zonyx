import {defineConfig} from '@playwright/test';
import base from './playwright.renewal.config';
export default defineConfig({...base,testMatch:['public-accessibility.spec.ts']});
