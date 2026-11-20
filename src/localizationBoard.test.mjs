import test from 'node:test';
import assert from 'node:assert/strict';
import {buildLocalizationBoard,localizationBoardHtml} from './localizationBoard.mjs';
import {writeLocalizationBoardPptx} from './localizationBoardPptx.mjs';
const employee={id:1,company_id:'A',gosi_salary:4000};
const row=(floor,verified=true)=>({rule_code:'ENGINEERING_2026',matchedCount:2,saudiCount:1,saudiBelowSalaryCount:1,unknownEligibilityCount:0,regulatoryVerification:{verified},eligibility:[{employee,belowSalary:true,wage:4000,floor}]});
const snapshot=(rows)=>({asOf:'2026-11-20',scope:'Company',people:[employee,{id:2,company_id:'A',gosi_salary:null}],saudiCount:1,report:{current:rows,upcoming:[]},tawteen:{companyId:'A',employeeAttributes:[{employee_id:1,company_id:'A',profession_code:'123'},{employee_id:2,company_id:'B',profession_code:'999'}],professions:[]}});
test('wage scenario counts each employee once at the highest reviewed floor and excludes unreviewed policies',()=>{
 const m=buildLocalizationBoard(snapshot([row(8000),row(9000),row(15000,false)]));
 assert.equal(m.wageScenario,5000);assert.equal(m.wageCaseCount,1);assert.equal(m.pendingPolicy.length,1);
 assert.equal(m.mapped,1);assert.equal(m.missingCode,1);assert.equal(m.mappedOutsideRules,1);
 assert.equal(m.recordedWages,1);assert.equal(m.scopeConfirmed,false);assert.equal(m.headcountRate,50);
});
test('empty population has no invented percentage or budget; HTML escapes company and supports both languages',()=>{
 const m=buildLocalizationBoard({...snapshot([]),people:[],saudiCount:0},{companyName:'<script>unsafe</script>',language:'Bilingual'});
 assert.equal(m.headcountRate,null);assert.equal(m.wageScenario,null);
 const html=localizationBoardHtml(m);assert.ok(html.includes('&lt;script&gt;'));assert.ok(!html.includes('<script>unsafe'));
 assert.ok(html.includes('Executive summary'));assert.ok(html.includes('الملخص التنفيذي'));assert.ok(!html.includes('undefined'));
});
test('board export includes native charts and keeps all text inside the slide',async()=>{
 const slides=[];let saved=false;
 class Pptx{ChartType={bar:'bar'};addSlide(){const s={charts:[],addText(){},addShape(){},addTable(){},addChart(type,data,options){this.charts.push({type,data,options})}};slides.push(s);return s}async writeFile(){saved=true}}
 const m=buildLocalizationBoard(snapshot([row(8000)]));
 const {geometry}=await writeLocalizationBoardPptx('test.pptx',m,{loadPptxgen:async()=>({default:Pptx})});
 assert.equal(saved,true);assert.ok(slides.length>=5);const c=slides.flatMap(s=>s.charts)[0];assert.equal(c.data[0].values[0],1);assert.equal(c.options.valAxisMinVal,0);
 assert.ok(geometry.every(b=>b.x>=0&&b.y>=0&&b.x+b.w<=13.334&&b.y+b.h<=7.5));
});
