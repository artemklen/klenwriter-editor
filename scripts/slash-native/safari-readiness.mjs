// SPDX-License-Identifier: MIT OR Apache-2.0
// Private bootstrap read only. Never supplies authority for subsequent input.
import assert from 'node:assert/strict';

const inspection='osr43-native-window-inspection/1';
const notReady='Unique measured AXWebArea viewport unavailable';
const successKeys=['format','status','delivery','browser','nonce','title','fixtureUrl','frontBundle','frontPid',
  'expectedAxWindowTitle','observedAxWindowTitle','axWindowCount','axMatchCount','visitedNodes','maximumDepth',
  'axWindow','axViewport','contained','elapsedMs'];
const exact=(value,keys)=>value!==null&&typeof value==='object'&&!Array.isArray(value)
  &&Object.keys(value).sort().join('\0')===[...keys].sort().join('\0');
const finite=value=>typeof value==='number'&&Number.isFinite(value);
const integer=(value,min,max)=>Number.isSafeInteger(value)&&value>=min&&value<=max;
function rectangle(value){
  assert.ok(exact(value,['x','y','width','height']),'Closed AX rectangle required');
  assert.ok(Object.values(value).every(finite)&&value.width>0&&value.height>0
    &&finite(value.x+value.width)&&finite(value.y+value.height),'Finite positive AX rectangle required');
  return value;
}

export async function prepareSafariAxReadiness({config,inputHelper,run,remainingNavigate,record=()=>{},
  originalPid=null,clock=()=>performance.now(),delay=ms=>new Promise(resolve=>setTimeout(resolve,ms))}){
  const began=clock(),samples=[],waits=[];
  const result={status:'refused',scope:'Read-only bootstrap preparation; not subsequent input authority',samples,waits};
  function budgets(){
    const elapsed=clock()-began,nav=remainingNavigate();
    assert.ok(finite(elapsed)&&elapsed>=0&&finite(nav),'Finite monotonic readiness and original navigate budgets required');
    assert.ok(elapsed<2000&&nav>0,'Safari AX readiness or original navigate budget exhausted');
    return{privateMs:2000-elapsed,navigateMs:nav};
  }
  try{
    assert.ok(typeof config?.nonce==='string'&&config.nonce.length===32&&/^[a-f0-9]{32}$/.test(config.nonce),'Closed Safari nonce required');
    assert.equal(config.title,'KlenWriter Slash native '+config.nonce);assert.equal(config.fixtureUrl,'http://127.0.0.1:4174/ui');
    assert.ok(typeof inputHelper==='string'&&inputHelper.startsWith('/')&&!inputHelper.includes('\0')
      &&Buffer.byteLength(inputHelper)<=4096,'Fixed compiled input helper path required');
    assert.ok(originalPid===null||integer(originalPid,1,2147483647),'Known original PID must be positive Int32');
    for(let sample=1;sample<=3;sample++){
      const left=budgets(),timeout=Math.floor(Math.min(500,left.privateMs,left.navigateMs));
      assert.ok(timeout>0,'No positive Safari AX sample allowance remains');
      const request={format:inspection,browser:'safari',nonce:config.nonce,title:config.title,fixtureUrl:config.fixtureUrl,deadlineMs:timeout};
      const argv=['--inspect-window',JSON.stringify(request)];
      const row={sample,request,execution:null,actual:null};samples.push(row);
      let thrown=null;const sampleBegan=clock();
      try{row.execution=run(inputHelper,argv,{timeout,fullStdout:true,maxBuffer:32768});}
      catch(error){thrown=error;row.execution=error.execution??null;}
      row.elapsedMs=clock()-sampleBegan;
      record('safari-ax-readiness-sample',row);
      assert.ok(finite(row.elapsedMs)&&row.elapsedMs>=0&&row.elapsedMs<=timeout,'Safari AX sample returned outside its original deadline');
      budgets();
      const execution=row.execution;
      assert.ok(execution&&execution.command===inputHelper,'Readiness execution command differs');
      assert.deepEqual(execution.argv,argv,'Readiness execution argv differs');
      assert.equal(execution.error,null,'Readiness process error');assert.equal(execution.signal,null,'Readiness process signal');
      assert.equal(execution.stderr,'','Readiness process stderr must be empty');
      assert.ok(typeof execution.stdout==='string'&&Buffer.byteLength(execution.stdout)<=32768,'Bounded full readiness stdout required');
      const actual=JSON.parse(execution.stdout);row.actual=actual;
      assert.ok(finite(actual?.elapsedMs)&&actual.elapsedMs>=0&&actual.elapsedMs<=timeout,'Readiness helper elapsed exceeds sample deadline');
      record('safari-ax-readiness-result',row);
      if(execution.returnCode===0){
        assert.equal(thrown,null,'Thrown completion cannot establish readiness');
        assert.ok(exact(actual,successKeys),'Closed 19-field Safari AX inspection required');
        for(const [key,value]of Object.entries({format:inspection,status:'inspected',delivery:'not_sent',browser:'safari',
          nonce:config.nonce,title:config.title,fixtureUrl:config.fixtureUrl,frontBundle:'com.apple.Safari',
          expectedAxWindowTitle:config.title,observedAxWindowTitle:config.title,axMatchCount:1,contained:true}))assert.equal(actual[key],value,'Safari AX proof '+key);
        assert.ok(integer(actual.frontPid,1,2147483647),'Positive actual Safari PID required');
        if(originalPid!==null)assert.equal(actual.frontPid,originalPid,'Original Safari PID changed');
        assert.ok(integer(actual.axWindowCount,1,32)&&integer(actual.visitedNodes,1,512)&&integer(actual.maximumDepth,0,32),'Safari AX observation bounds differ');
        const frame=rectangle(actual.axWindow),view=rectangle(actual.axViewport);
        assert.ok(Math.abs(view.width-1024)<=2&&Math.abs(view.height-768)<=2,'Frozen Safari AX viewport size differs');
        assert.ok(view.x>=frame.x-.5&&view.x+view.width<=frame.x+frame.width+.5
          &&view.y>=frame.y-.5&&view.y+view.height<=frame.y+frame.height+.5,'Safari AX viewport not contained');
        budgets();result.status='ready';result.measurement=actual;break;
      }
      assert.equal(execution.returnCode,2,'Unexpected Safari AX inspection exit');
      assert.ok(exact(actual,['status','reason','delivery','elapsedMs']),'Closed four-field Safari AX refusal required');
      assert.equal(actual.status,'refused');assert.equal(actual.delivery,'not_sent');assert.equal(actual.reason,notReady,'Safari AX refusal is not retryable');
      if(sample===3){result.reason='Safari AX viewport remained unavailable after three read-only samples';break;}
      const next=budgets();assert.ok(Math.floor(next.privateMs-100)>0&&Math.floor(next.navigateMs-100)>0,'No budget for passive wait and another AX sample');
      const wait={afterSample:sample,durationMs:100};waits.push(wait);record('safari-ax-readiness-wait',wait);
      await delay(100);budgets();
    }
  }catch(error){result.reason=String(error?.message??error);}
  result.elapsedMs=clock()-began;
  if(result.status==='ready'){
    try{budgets();assert.ok(finite(result.elapsedMs)&&result.elapsedMs>=0&&result.elapsedMs<2000,'Safari AX readiness return exceeded budget');}
    catch(error){result.status='refused';result.reason=String(error?.message??error);}
  }
  record('safari-ax-readiness-terminal',result);return result;
}
