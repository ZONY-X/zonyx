import {defineConfig} from '@playwright/test';
import base from './playwright.renewal.config';
export default defineConfig({...base,testMatch:['square-card-on-file.spec.ts']});
