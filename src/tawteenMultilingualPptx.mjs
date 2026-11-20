import {buildTawteenDisplay,t,date,reportLanguage} from './tawteenReportLocale.mjs';
import {executiveChartData} from './tawteenExecutive.mjs';
import {ruleName} from './tawteenReportLocale.mjs';

export async function writeTawteenPptx(fileName,data,{loadPptxgen,mode='executive'}={}) {
  const model=buildTawteenDisplay(data.tawteen_localization||{}, {language:data.language,mode:data.report_mode||mode,asOf:data.generated_date||String(data.generated_at||'').slice(0,10)});
  const {default:Pptx}=await loadPptxgen();const pptx=new Pptx();
  pptx.layout='LAYOUT_WIDE';pptx.author='VisaFlow KSA';pptx.company='VisaFlow KSA';
  pptx.title=model.languages.map(l=>t('title',l)).join(' / ');
  pptx.subject=model.languages.map(l=>t(model.mode,l)).join(' / ');
  pptx.lang=model.language==='en'?'en-GB':'ar-SA';pptx.theme={headFontFace:'Arial',bodyFontFace:'Arial',lang:pptx.lang};
  const geometry=[];
  const W=13.333,H=7.5;
  const chartData=executiveChartData(data.tawteen_localization||{});
  const chartSlides=[{kind:'status',items:chartData.status}];
  const groups=chartData.groups.filter(g=>g.row.saudiCount>0);
  for(let i=0;i<groups.length;i+=4)chartSlides.push({kind:'eligibility',items:groups.slice(i,i+4)});
  for(const chart of chartSlides){
    const slide=pptx.addSlide();slide.background={color:'FFFFFF'};
    const ar=model.language!=='en',label=(a,e)=>model.language==='mixed'?a+' / '+e:ar?a:e;
    const term=k=>label(t(k,'ar'),t(k,'en'));
    slide.addText(label(chart.kind==='status'?'حالة القرارات الحالية':'أهلية السعوديين بحسب المجموعة',chart.kind==='status'?'Current decision status':'Saudi eligibility by occupational group'),{x:.65,y:.4,w:12,h:.6,fontFace:'Arial',fontSize:26,color:'193247',rtlMode:ar,align:ar?'right':'left'});
    chart.items.forEach((item,i)=>{
      const y=1.4+i*1.12;
      const segments=chart.kind==='status'?[{value:item.value,color:item.color,key:item.key}]:[{value:item.eligible,color:'#087f70',key:'eligible'},{value:item.ineligible,color:'#c34444',key:'ineligible'},{value:item.unknown,color:'#a96c13',key:'unresolved'}];
      const max=chart.kind==='status'?Math.max(1,chartData.status.reduce((s,x)=>s+x.value,0)):item.row.saudiCount;
      const title=chart.kind==='status'?term(item.key):label(ruleName(item.row,'ar'),ruleName(item.row,'en'))+' · '+item.row.rule_code;
      slide.addText(title,{x:.65,y,w:12,h:.3,fontFace:'Arial',fontSize:16,rtlMode:ar,align:ar?'right':'left',color:'193247'});
      slide.addShape('rect',{x:.65,y:y+.4,w:12,h:.16,line:{color:'EDF1F4'},fill:{color:'EDF1F4'}});
      let x=.65;
      for(const s of segments){const w=12*s.value/max;if(w>0)slide.addShape('rect',{x,y:y+.4,w,h:.16,line:{color:s.color.slice(1)},fill:{color:s.color.slice(1)}});x+=w;}
      slide.addText(segments.map(s=>term(s.key)+': '+s.value).join(' · '),{x:.65,y:y+.63,w:12,h:.3,fontFace:'Arial',fontSize:12,rtlMode:ar,align:ar?'right':'left',color:'526879'});
    });
    slide.addText(label('الأعداد لكل قرار؛ لا تجمع الموظفين بين المجموعات. الأهلية لا تؤكد نطاق الانطباق.','Counts are per decision; do not sum employees across groups. Eligibility does not confirm scope.'),{x:.65,y:6.4,w:12,h:.4,fontFace:'Arial',fontSize:12,rtlMode:ar,align:ar?'right':'left',color:'81521A'});
    slide.addText(t('disclaimer',ar?'ar':'en'),{x:.65,y:7,w:12,h:.25,fontFace:'Arial',fontSize:10,rtlMode:ar,align:ar?'right':'left',color:'526879'});
  }
  for(const [index,page] of model.pages.entries()) {
    const slide=pptx.addSlide();slide.background={color:'F6F8FB'};
    const boxes=[];geometry.push({page:index+1,key:page.key,boxes});
    const text=(value,x,y,w,h,size,l,extra={})=>{
      if(!value)return;
      boxes.push({text:String(value),x,y,w,h,size,language:l,rtl:l==='ar'});
      slide.addText(String(value),{x,y,w,h,fontFace:'Arial',fontSize:size,color:'152C42',margin:0,breakLine:false,rtlMode:l==='ar',rtl:l==='ar',align:l==='ar'?'right':'left',valign:'top',...extra});
    };
    slide.addShape('rect',{x:0,y:0,w:W,h:.09,fill:{color:'087F8C'},line:{color:'087F8C'}});
    const mixed=model.language==='mixed';
    if(mixed)slide.addShape('line',{x:W/2,y:.4,w:0,h:6.3,line:{color:'D4DCE5',width:1}});
    for(const l of model.languages) {
      const x=mixed?(l==='ar'?6.96:.55):.65;
      const w=mixed?5.8:12.03;
      text(page.title[l],x,.38,w,.72,mixed?24:30,l,{bold:true});
      const count=page.blocks.length;
      const chartPage=page.chart&&model.mode==='executive';
      const bodyTop=1.4,bodyHeight=chartPage?4.45:5.32;
      // Mixed columns contain the exact same records, with independent paragraph direction.
      const slot=count?bodyHeight/count:bodyHeight;
      page.blocks.forEach((block,i)=>{
        const lines=String(block[l]).split('\n').length;
        const size=chartPage?(mixed?14:19):model.mode==='detailed'?(mixed?14:17):(mixed?16:21);
        const content=block[l];
        text(content,x,bodyTop+i*slot,w,slot-.14,size,l,{color:page.key==='summary'&&i===0?'9A5B06':'152C42',paraSpaceAfterPt:5});
        if(i<count-1)slide.addShape('line',{x,y:bodyTop+(i+1)*slot-.07,w,h:0,line:{color:'DFE6ED',width:.5}});
      });
      if(page.links)page.links.forEach((url,i)=>{
        if(url)text(t('source',l),x,bodyTop+(i+1)*slot-.42,w,.28,14,l,{color:'1565A7',hyperlink:{url:encodeURI(url)}});
      });
      text(`${t('disclaimer',l)}\n${date(model.asOf,l)}`,x,7.02,w-.5,.34,mixed?8:9,l,{color:'617386'});
    }
    // One proportional bar communicates the nationality comparison without invented trends.
    if(page.chart&&model.mode==='executive') {
      const total=page.chart.values.reduce((a,b)=>a+b,0);const ratio=total?page.chart.values[0]/total:0;
      slide.addShape('rect',{x:.65,y:6.35,w:12.03,h:.17,fill:{color:'BBC8D6'},line:{color:'BBC8D6'}});
      if(ratio>0)slide.addShape('rect',{x:.65,y:6.35,w:12.03*ratio,h:.17,fill:{color:'087F8C'},line:{color:'087F8C'}});
      for(const l of model.languages) {
        const x=mixed?(l==='ar'?6.96:.55):.65,w=mixed?5.8:12.03;
        text(`${t('saudi',l)} ${page.chart.values[0]} / ${t('nonSaudi',l)} ${page.chart.values[1]}`,x,6.57,w,.23,11,l);
      }
    }
    text(`${index+1} / ${model.pages.length}`,12.05,7.12,.63,.19,9,'en',{align:'right',color:'617386'});
  }
  await pptx.writeFile({fileName});
  return {model,geometry};
}

export function validateGeometry(geometry) {
  const errors=[];
  for(const p of geometry)for(const b of p.boxes) {
    if(b.x<0||b.y<0||b.x+b.w>13.334||b.y+b.h>7.501)errors.push(`Slide ${p.page}: out of canvas`);
    if(b.size<14&&b.y<6.3)errors.push(`Slide ${p.page}: body font too small`);
    if(b.rtl!==(b.language==='ar'))errors.push(`Slide ${p.page}: direction mismatch`);
  }
  return errors;
}
