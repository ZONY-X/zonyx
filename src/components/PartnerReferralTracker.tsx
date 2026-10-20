import {useEffect} from 'react';
import {useLocation} from 'react-router-dom';
import {rememberPartner} from '@/lib/partners';
export function PartnerReferralTracker(){const location=useLocation();useEffect(()=>{const code=new URLSearchParams(location.search).get('ref');if(code)void rememberPartner(code,'link').catch(()=>{/* Invalid or conflicting codes never interrupt browsing or checkout. */});},[location.search]);return null;}
