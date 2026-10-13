import assert from 'node:assert/strict';
import {test} from 'node:test';
import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import {installFakeDom} from './helpers/fake-dom.mjs';
const dom=installFakeDom();
document.dispatchEvent=e=>{for(const fn of document.listeners.get(e.type)||[])fn(e);return true};
const {AccountsScreen}=await import('../../dist/apps/web/src/screens/AccountsScreen.js');
const response=data=>({ok:true,status:200,json:async()=>({success:true,data})});
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve}};
const tick=()=>act(async()=>{await new Promise(r=>setTimeout(r,5))});
const button=(c,text)=>dom.find(c,n=>n.nodeName==='BUTTON'&&n.textContent.includes(text))[0];
async function setup(){
 document.visibilityState='visible';const pending=deferred();let signal;
 globalThis.fetch=async(url,opts={})=>{
  if(url.endsWith('/auth/me'))return response({csrf_token:'synthetic-csrf'});
  if(url.endsWith('/auth/reauth'))return response({reauth_proof:'synthetic-proof'});
  if(url.includes('/secrets/reveal')){signal=opts.signal;return pending.promise}
  return response({items:[{id:'a1',username:'synthetic-account',platform:'other',status:'active',version:1}]});
 };
 const c=dom.container(),root=createRoot(c);
 await act(async()=>root.render(React.createElement(AccountsScreen,{role:'owner',onNavigate:()=>{}})));await tick();
 await act(async()=>dom.props(button(c,'Xem pass')).onClick());
 const inp=dom.find(c,n=>n.nodeName==='INPUT'&&dom.props(n).type==='password')[0];
 await act(async()=>dom.props(inp).onChange({target:{value:'synthetic-reauth'}}));
 const form=dom.find(c,n=>n.nodeName==='FORM')[0];let task;
 await act(async()=>{task=dom.props(form).onSubmit({preventDefault(){}});await Promise.resolve()});await tick();
 return {c,root,pending,signal:()=>signal,task:()=>task};
}
test('Mounted ACC: Escape aborts pending reveal and a reopened modal remains usable',async()=>{
 const s=await setup();try{
 await act(async()=>window.dispatchEvent({type:'keydown',key:'Escape'}));
 assert.equal(s.signal().aborted,true,'Escape must abort request');
 await act(async()=>s.pending.resolve(response({secret_value:'synthetic-secret'})));await s.task();await tick();
 assert.equal(s.c.textContent.includes('synthetic-secret'),false);
 await act(async()=>dom.props(button(s.c,'Xem pass')).onClick());
 const inp=dom.find(s.c,n=>n.nodeName==='INPUT'&&dom.props(n).type==='password')[0];
 await act(async()=>dom.props(inp).onChange({target:{value:'synthetic-reauth'}}));
 const submit=dom.find(s.c,n=>n.nodeName==='BUTTON'&&dom.props(n).type==='submit')[0];
 assert.equal(dom.props(submit).disabled,false,'Reopened modal must not remain stuck in actionLoading');
 }finally{await act(async()=>s.root.unmount())}
});
test('Mounted ACC: hidden-then-visible while reveal pending must invalidate response',async()=>{
 const s=await setup();try{
 await act(async()=>{document.visibilityState='hidden';document.dispatchEvent({type:'visibilitychange'})});
 await act(async()=>{document.visibilityState='visible';document.dispatchEvent({type:'visibilitychange'})});
 await act(async()=>s.pending.resolve(response({secret_value:'synthetic-secret'})));await s.task();await tick();
 assert.equal(s.c.textContent.includes('synthetic-secret'),false,'Background transition must invalidate in-flight reveal');
 }finally{await act(async()=>s.root.unmount())}
});
const {PayrollScreen}=await import('../../dist/apps/web/src/screens/PayrollScreen.js');
test('Mounted PAY: retry after lost response preserves logical-operation key',async()=>{
 const sent=[];
 const item={id:'pay1',employee_id:'emp1',employee_code:'QA01',full_name:'Synthetic Staff',hourly_rate_vnd:40000,total_hours:160,gross_pay_vnd:6400000,net_pay_vnd:6400000,confirmed:{net_pay_vnd:6400000,paid_amount_vnd:0},work_shifts:[],adjustments:[],paid_leaves:[]};
 globalThis.fetch=async(url,opts={})=>{
  if(url.includes('/adjustments')){sent.push({key:opts.headers['Idempotency-Key'],body:opts.body});throw new Error('Synthetic lost response after server commit')}
  if(url.includes('/auth/me'))return response({csrf_token:'synthetic-csrf',user:{id:'u1'},active_workspace:{id:'w1',role:'owner'}});
  if(url.includes('/payroll/periods'))return response({period:{id:'p1',month:'2026-10',status:'draft',version:1},items:[item]});
  return response({items:[]});
 };
 const c=dom.container(),root=createRoot(c),byId=id=>dom.find(c,n=>dom.props(n)['data-testid']===id)[0];
 try{
 await act(async()=>root.render(React.createElement(PayrollScreen,{role:'owner',onNavigate:()=>{}})));await tick();
 await act(async()=>dom.props(byId('btn-add-adjustment-emp1')).onClick());
 await act(async()=>dom.props(byId('adjustment-reason-input')).onChange({target:{value:'Synthetic paid leave'}}));
 await act(async()=>dom.props(byId('adjustment-submit-btn')).onClick());
 await act(async()=>dom.props(byId('adjustment-submit-btn')).onClick());
 assert.equal(sent.length,2);assert.equal(sent[0].body,sent[1].body);
 assert.equal(sent[0].key,sent[1].key,'Same pending logical operation must reuse key');
 }finally{await act(async()=>root.unmount())}
});
