// SPDX-License-Identifier: MIT OR Apache-2.0
import {test,expect} from '@playwright/test';

test('composition CSP admits the exact native wrapper declaration and blocks other inline styles',async({page,request},info)=>{
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  const response=await page.goto('/composition'),policy=response.headers()['content-security-policy'];
  expect(policy).toContain("style-src 'self'");
  expect(policy).toContain("style-src-attr 'unsafe-hashes' 'sha256-Bik11TcNhgFEPza2gjD1hgP18nxqnHcOjH8nICs6uM8='");
  expect(policy).not.toMatch(/'unsafe-inline'|'unsafe-eval'/);
  await page.waitForFunction(()=>window.compositionHostReady);
  const observed=await page.evaluate(async()=>{
    const events=[];document.addEventListener('securitypolicyviolation',event=>events.push({directive:event.effectiveDirective,blocked:event.blockedURI}));
    const nextFrame=()=>new Promise(requestAnimationFrame);
    const allowed=document.createElement('span');allowed.textContent='allowed';
    allowed.setAttribute('style','white-space: pre-wrap; display: inline !important; float: none;');document.body.append(allowed);
    await nextFrame();await nextFrame();
    const exact={whiteSpace:getComputedStyle(allowed).whiteSpace,display:getComputedStyle(allowed).display,float:getComputedStyle(allowed).cssFloat,violations:events.slice()};
    // A byte-different attribute remains blocked even with the allowed prefix.
    const other=document.createElement('span');other.textContent='blocked';
    other.setAttribute('style','white-space: pre-wrap; display: inline !important; float: none; color: rgb(255, 0, 0);');document.body.append(other);
    // The attribute exception cannot authorize an inline stylesheet.
    const sheet=document.createElement('style');sheet.textContent='body { color: rgb(255, 0, 0); }';document.head.append(sheet);
    for(let reads=0;reads<8&&events.length<2;reads++)await nextFrame();
    const result={exact,otherWhiteSpace:getComputedStyle(other).whiteSpace,otherColor:getComputedStyle(other).color,bodyColor:getComputedStyle(document.body).color,events:events.slice()};
    allowed.remove();other.remove();sheet.remove();return result;
  });
  expect(observed.exact).toEqual({whiteSpace:'pre-wrap',display:'inline',float:'none',violations:[]});
  expect(observed.otherWhiteSpace).toBe('normal');
  expect(observed.otherColor).not.toBe('rgb(255, 0, 0)');expect(observed.bodyColor).not.toBe('rgb(255, 0, 0)');
  expect(observed.events).toHaveLength(2);
  expect(observed.events).toEqual(expect.arrayContaining([{directive:'style-src-attr',blocked:'inline'},{directive:'style-src-elem',blocked:'inline'}]));
  expect(errors).toEqual([]);
  const unrelated=await request.get('/dom');expect(unrelated.headers()['content-security-policy']).not.toContain('unsafe-hashes');
  await info.attach('composition-csp-boundary',{body:JSON.stringify({policy,observed,errors}),contentType:'application/json'});
});
