export type RenewalCard = { configure(options:{postalCode:string}):Promise<void>; attach(element: HTMLElement): Promise<void>; destroy(): Promise<void>; tokenize(details: Record<string, unknown>): Promise<{status: string; token?: string}> };
type SquareSDK = {payments(app: string,location: string): {card(options?: {style: Record<string,unknown>}): Promise<RenewalCard>}};
let sdkPromise:Promise<SquareSDK>|undefined;
async function loadSquare(){
 return sdkPromise??=new Promise<SquareSDK>((resolve,reject)=>{
  const existing=(window as Window & {Square?:SquareSDK}).Square;if(existing){resolve(existing);return;}
  const script=document.createElement('script');script.src='https://web.squarecdn.com/v1/square.js';
  script.onload=()=>{const sdk=(window as Window & {Square?:SquareSDK}).Square;if(sdk)resolve(sdk);else{sdkPromise=undefined;reject(new Error('Secure card form unavailable.'));}};
  script.onerror=()=>{sdkPromise=undefined;script.remove();reject(new Error('Secure card form could not load.'));};document.head.appendChild(script);
 });
}

export async function createRenewalCard(config: {provider: string; environment: string; applicationId: string; locationId: string}) {
 if(config.provider !== 'square' || config.environment !== 'live') throw new Error('Secure renewal card form is unavailable.');
 const sdk = await loadSquare();
 return sdk.payments(config.applicationId, config.locationId).card({style:{'.input-container':{borderColor:'#2a2a2a',borderRadius:'12px'},'.input-container.is-focus':{borderColor:'#0fd8c4'},input:{backgroundColor:'#0b0b0b',color:'#ffffff',fontSize:'18px'},'input::placeholder':{color:'#6b7280'},'.message-text':{color:'#9ca3af'}}});
}
