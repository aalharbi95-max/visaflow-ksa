import {useState} from 'react';
import {executiveSections,executiveStyles} from './tawteenExecutive.mjs';
export default function TawteenExecutiveReport({report,language,asOf,scope}){
 const [active,setActive]=useState('summary');
 const sections=executiveSections(report,{language,asOf,scope});
 const labels={summary:['الملخص التنفيذي','Executive summary'],people:['تفاصيل الاحتساب','Eligibility details'],plan:['خطة المعالجة','Action plan'],quality:['البيانات والمصادر','Data and sources']};
 return <div className="tx"><style>{executiveStyles}</style><nav className="tx-nav" role="tablist" aria-label="Tawteen report sections">{Object.entries(labels).map(([key,pair])=><button key={key} id={`tx-tab-${key}`} role="tab" aria-controls={`tx-panel-${key}`} aria-selected={active===key} onClick={()=>setActive(key)}>{language==='English'?pair[1]:language==='Bilingual'?pair.join(' / '):pair[0]}</button>)}</nav>{Object.entries(sections).map(([key,html])=><section key={key} role="tabpanel" id={`tx-panel-${key}`} aria-labelledby={`tx-tab-${key}`} hidden={active!==key} dangerouslySetInnerHTML={{__html:html}}/>)}</div>;
}
