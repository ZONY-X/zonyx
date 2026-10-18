import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import type { ExecutedRentalAgreement } from './executedRentalAgreement';
import { currentAgreementText } from './operativeAgreement';
import zonyxOfficialLogo from '../assets/zonyx-official-logo.png?url';
// PDF is a readable copy of the view. Source hashes identify the immutable records,
// never the newly rendered PDF bytes.
const printable=(text:string)=>text.replaceAll('→',' -> ').replaceAll('⸻','').replaceAll('−','-').replaceAll('\u202f',' ').replaceAll('\u00a0',' ').replace(/[^\x20-\x7e\u00a0-\u00ff\u2013\u2014\u2018\u2019\u201c\u201d\u2022\u2026\n]/g,'');
export async function currentAgreementPdf(a:ExecutedRentalAgreement):Promise<Uint8Array>{
 const pdf=await PDFDocument.create();const font=await pdf.embedFont(StandardFonts.Helvetica),bold=await pdf.embedFont(StandardFonts.HelveticaBold);
 const logoResponse=await fetch(zonyxOfficialLogo);if(!logoResponse.ok)throw new Error('Unable to load the ZONYX logo. Please refresh and try again.');
 const logo=await pdf.embedPng(await logoResponse.arrayBuffer());const logoWidth=160,logoHeight=logoWidth*logo.height/logo.width;
 pdf.setTitle(`${a.reservation_number} — Current Operative Rental Agreement`);pdf.setAuthor('ZONYX');pdf.setSubject('Read-only consolidated agreement view and preserved source evidence');
 const width=595.28,height=841.89,margin=48,lineHeight=15.5;let page=pdf.addPage([width,height]),y=height-92;
 const header=()=>{page.drawRectangle({x:0,y:height-54,width,height:54,color:rgb(.035,.055,.055)});page.drawImage(logo,{x:margin,y:height-27-logoHeight/2,width:logoWidth,height:logoHeight});page.drawText(printable(a.reservation_number),{x:width-margin-100,y:height-32,size:10,font,color:rgb(1,1,1)});};header();
 const next=()=>{page=pdf.addPage([width,height]);y=height-86;header();};
 const lines=currentAgreementText(a).replaceAll('\\n','\n').split('\n');
 for(const raw of lines){const text=printable(raw).trim();if(!text){y-=7;continue;}
  const heading=text.length<100&&((text===text.toUpperCase()&&/[A-Z]/.test(text))||/^(?:\d+|A\d+)\. [A-Z]/.test(text));const f=heading?bold:font,size=heading?12:11;
  const words=text.split(/\s+/);const wrapped:string[]=[];let line='';for(let word of words){if(f.widthOfTextAtSize(word,size)>width-margin*2){if(line){wrapped.push(line);line='';}let part='';for(const c of word){if(f.widthOfTextAtSize(part+c,size)>width-margin*2){wrapped.push(part);part='';}part+=c;}word=part;}const candidate=line?line+' '+word:word;if(f.widthOfTextAtSize(candidate,size)>width-margin*2){wrapped.push(line);line=word;}else line=candidate;}if(line)wrapped.push(line);
  if(heading&&y<85+lineHeight*Math.min(wrapped.length+2,5))next();if(heading)y-=5;
  for(const line of wrapped){if(y<62)next();page.drawText(line,{x:margin,y,size,font:f,color:rgb(.09,.12,.13)});y-=lineHeight;}if(heading)y-=4;
 }
 const pages=pdf.getPages();pages.forEach((p,i)=>{p.drawLine({start:{x:margin,y:43},end:{x:width-margin,y:43},thickness:.5,color:rgb(.75,.78,.78)});p.drawText('ZONYX | Current operative agreement | Preserved source records',{x:margin,y:29,size:8,font,color:rgb(.35,.38,.38)});p.drawText(`${i+1} / ${pages.length}`,{x:width-margin-34,y:29,size:8,font,color:rgb(.35,.38,.38)});});return pdf.save();
}
