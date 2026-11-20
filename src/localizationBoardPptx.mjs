import {boardCopy,boardLabel} from './localizationBoard.mjs';
export async function writeLocalizationBoardPptx(fileName,model,{loadPptxgen=()=>import('pptxgenjs')}={}){
 const {default:Pptx}=await loadPptxgen(),pptx=new Pptx();
 pptx.layout='LAYOUT_WIDE';pptx.author='VisaFlow KSA';pptx.title='Localization & workforce';pptx.subject='Management report';
 pptx.theme={headFontFace:'Arial',bodyFontFace:'Arial',lang:model.language==='English'?'en-GB':'ar-SA'};
 const languages=model.language==='Bilingual'?['Arabic','English']:[model.language],geometry=[];
 for(const language of languages){
 const m={...model,language},{L,N,main,findings,actions}=boardCopy(m),ar=language!=='English';
 let slide; let pageNumber=0;
 const text=(value,x,y,w,h,size=18,extra={})=>{geometry.push({x,y,w,h,size});slide.addText(String(value),{x,y,w,h,fontFace:'Arial',fontSize:size,color:'183E46',margin:0,align:ar?'right':'left',rtlMode:ar,valign:'mid',breakLine:false,...extra});};
 const page=(title,kicker)=>{pageNumber++;slide=pptx.addSlide();slide.background={color:'FFFFFF'};slide.addShape('rect',{x:0,y:0,w:13.333,h:.12,line:{color:'153B43'},fill:{color:'153B43'}});text(`${m.companyName||'VisaFlow KSA'} · ${m.asOf}`, .65,.35,12,.25,11,{color:'617674'});text(title,.65,.85,12,.65,29,{bold:true});if(kicker)text(kicker,.65,1.55,12,.5,14,{color:'617674'});slide.addShape('line',{x:.65,y:6.92,w:12,h:0,line:{color:'DCE5E2',width:1}});text(L('داخلي · تخطيط إداري · ليس نتيجة رسمية من قوى','Internal · Management planning · Not an official Qiwa result'),.65,7.05,11,.23,10,{color:'617674'});text(String(pageNumber),12,7.05,.65,.23,10);};
 page(L('التوطين والقوى العاملة','Localization & workforce'),m.scope==='Company'?L('تقرير الإدارة التنفيذية · الشركة','Management report · Company'):m.scope);
 text(main,.75,2.12,11.8,.72,23,{bold:true,color:'087E83'});
 findings.forEach((p,i)=>text(p,.75,3.03+i*.87,11.8,.73,18));
 for(const [i,[v,label]] of [[m.total,L('إجمالي الموظفين','Total employees')],[m.saudi,L('سعوديون','Saudi employees')],[`${N(m.headcountRate,1)}%`,L('نسبة عددية وليست نطاقات','Headcount share, not Nitaqat')]].entries()){
  const x=.75+i*4;slide.addShape('rect',{x,y:5.78,w:3.8,h:.9,line:{color:'EEF4F3'},fill:{color:'EEF4F3'}});text(typeof v==='number'?N(v):v,x+.15,5.83,3.5,.4,27,{bold:true});text(label,x+.15,6.28,3.5,.24,12,{color:'50686B'});
 }
 const groups=[...m.reviewed].sort((a,b)=>b.matchedCount-a.matchedCount);
 if(!groups.length){page(L('المجموعات المهنية','Occupational groups'));text(L('لا توجد مجموعات مكتملة المراجعة في هذا النطاق.','No reviewed occupational groups in this scope.'),.8,2.5,11.7,1,22);}
 for(let offset=0;offset<groups.length;offset+=5){const rows=groups.slice(offset,offset+5);
 page(L('تركيبة المجموعات المهنية','Occupational group composition'),L('مجموعات ذات موظفين وشروط مراجَعة بالمحرك؛ انطباقها على الكيان يحتاج تحققًا','Populated groups with reviewed engine policies; entity applicability requires verification'));
 slide.addChart(pptx.ChartType.bar,[{name:L('سعوديون','Saudi'),labels:rows.map(r=>boardLabel(r,language)),values:rows.map(r=>r.saudiCount)},{name:L('غير سعوديين','Non-Saudi'),labels:rows.map(r=>boardLabel(r,language)),values:rows.map(r=>r.matchedCount-r.saudiCount)}],{x:.8,y:2.25,w:11.7,h:3.8,barDir:'bar',barGrouping:'stacked',showLegend:true,legendPos:'b',showValue:true,chartColors:['087E83','C8D5D3'],showTitle:false,catAxisLabelFontSize:15,valAxisLabelFontSize:11,showCatName:false,showBorder:false,valAxisMinVal:0,showCatName:false,showShadow:false,legendFontSize:12,fontFace:'Arial',showMarker:false});
 text(L('الأعداد للمقارنة داخل كل مجموعة؛ قد يتكرر الموظف بين المجموعات.','Compare counts within groups; employees can appear in more than one group.'),.8,6.25,11.7,.42,14,{color:'617674'});
 }
 page(L('الأجور والأهلية: ما الذي يحتاج معالجة؟','Wages and eligibility: what needs attention?'));
 const audit=groups.map(r=>[boardLabel(r,language),N(r.saudiBelowSalaryCount),N(r.unknownEligibilityCount)]);
 // Paginate independently so growing occupation sets cannot overflow the deck.
 for(let offset=0;offset<Math.max(1,audit.length);offset+=5){if(offset)page(L('الأجور والأهلية — متابعة','Wages and eligibility — continued'));
 slide.addTable([[L('المجموعة','Group'),L('دون حد الأجر','Below wage floor'),L('أهلية معلقة','Eligibility pending')],...audit.slice(offset,offset+5)],{x:.75,y:1.85,w:11.8,colW:[5.4,3.2,3.2],rowH:.5,fontSize:16,fontFace:'Arial',color:'183E46',margin:.13,border:{type:'solid',pt:.5,color:'DEE7E3'},fill:'FFFFFF',bold:false,align:ar?'right':'left',autoPage:false});
 text(m.wageScenario==null?L('لم يُحسب سيناريو زيادة أجور من البيانات المتاحة.','No wage uplift scenario was calculated from the available data.'):L(`فرق الأجور الحسابي: ${N(m.wageScenario)} ريال شهريًا لـ${N(m.wageCaseCount)} موظفًا دون تكرار.`,`Arithmetic wage difference: SAR ${N(m.wageScenario)} per month across ${N(m.wageCaseCount)} distinct employees.`),.8,5.35,11.7,.58,21,{bold:true,color:'087E83'});
 text(L('هذا سيناريو للمراجعة وليس ميزانية معتمدة. سد فرق الأجر لا يغني عن تأكيد نطاق القرار والاعتماد والمؤهل.','This is a review scenario, not an approved budget. Closing the wage difference does not replace scope, accreditation and qualification checks.'),.8,6.08,11.7,.57,15,{color:'617674'});
 }
 for(let offset=0;offset<Math.max(1,actions.length);offset+=3){page(L('القرارات والخطوات المقترحة','Proposed decisions and next steps'),L('للمراجعة قبل اعتماد أي توظيف أو تعديل أجور','For review before approving hiring or wage changes'));
 actions.slice(offset,offset+3).forEach(([a,b,c],i)=>{const y=2.25+i*1.35;text(String(offset+i+1).padStart(2,'0'),.75,y,.55,.45,23,{color:'AE7B32'});text(a,1.55,y,10.9,.4,21,{bold:true});text(b,1.55,y+.49,10.9,.43,16);text(c,1.55,y+.94,10.9,.28,13,{color:'617674'});});}
 page(L('أساس التقرير وحدود النتيجة','Evidence and limits'));
 const sources=[[L('رموز المهن المرتبطة','Mapped occupation codes'),`${N(m.mapped)} / ${N(m.total)}`],[L('بلا رمز مهنة','Without occupation codes'),N(m.missingCode)],[L('برموز تحتاج مراجعة تغطية القرارات','Coded occupations requiring rule-coverage review'),N(m.mappedOutsideRules)],[L('أجور خاضعة للاشتراك متاحة','Available contributory wages'),`${N(m.recordedWages)} / ${N(m.total)}`],[L('نطاق الكيان','Entity scope'),m.scopeConfirmed?L('مؤكد بالإعدادات','Confirmed in settings'):L('بانتظار التأكيد','Awaiting confirmation')],[L('تواريخ مصادر الأجور','Wage source dates'),m.sourceDates.join(', ')||L('غير مسجلة','Not recorded')]];
 slide.addTable(sources,{x:.75,y:1.9,w:11.8,colW:[8,3.8],rowH:.55,fontSize:16,fontFace:'Arial',color:'183E46',margin:.12,border:{pt:.5,color:'DEE7E3'},align:ar?'right':'left',autoPage:false});
 text(L(`توجد ${N(m.pendingPolicy.length)} مجموعات ذات موظفين لم تكتمل شروطها بالمكتبة. لا تُعرض كالتزام مؤكد. تفاصيل الموظفين والمصادر متاحة في وضع التدقيق بالمنصة.`,`${N(m.pendingPolicy.length)} populated groups have incomplete library policies and are not presented as confirmed obligations. Employee details and sources remain in the platform’s audit view.`),.8,5.65,11.7,.9,17,{color:'617674'});
 }
 await pptx.writeFile({fileName});return {geometry};
}
