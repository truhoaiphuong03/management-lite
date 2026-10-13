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

test('Mounted ACC independent: reopening reveal invalidates pending old request',async()=>{
 const s=await setup();try{
 await act(async()=>dom.props(button(s.c,'Xem pass')).onClick());
 await act(async()=>s.pending.resolve(response({secret_value:'synthetic-stale-secret'})));await s.task();await tick();
 assert.equal(s.c.textContent.includes('synthetic-stale-secret'),false,'Old response must not populate reopened modal');
 }finally{await act(async()=>s.root.unmount())}
});
