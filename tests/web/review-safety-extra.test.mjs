import assert from 'node:assert/strict';import{test}from'node:test';
import{validateQaTarget,verifyIsolatedQaService,sanitizeErrorMessage}from'../../scripts/qa-target-safety.mjs';
test('Unknown unprivileged port must not pass an explicit allowlist',()=>assert.throws(()=>validateQaTarget('http://127.0.0.1:54321')));
test('Unavailable service must fail closed',async()=>{globalThis.fetch=async()=>{throw new Error('Synthetic offline')};await assert.rejects(()=>verifyIsolatedQaService('http://127.0.0.1:3037'))});
test('Unidentified service returning 500 must fail closed',async()=>{globalThis.fetch=async()=>({status:500,headers:{get:()=>null}});await assert.rejects(()=>verifyIsolatedQaService('http://127.0.0.1:3037'))});
test('Redirect to blocked operational port must fail closed',async()=>{globalThis.fetch=async()=>({status:302,headers:{get:()=> 'http://127.0.0.1:3000/login'}});await assert.rejects(()=>verifyIsolatedQaService('http://127.0.0.1:3037'))});
test('Raw CDP error must never echo arbitrary secret without field label',()=>{const marker='synthetic-sensitive-phrase';assert.equal(sanitizeErrorMessage(new Error('Evaluation failed: '+marker)).includes(marker),false)});
