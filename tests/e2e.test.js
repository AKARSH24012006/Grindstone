const { chromium } = require('playwright');
const path = require('path').resolve(process.argv[2] || __dirname + '/../index.html');
const shots = process.argv[3] || require('os').tmpdir();
const results = []; const ok=(n,c,extra='')=>results.push(`${c?'PASS':'FAIL'}  ${n}${extra?'  — '+extra:''}`);
(async()=>{
  const b = await chromium.launch();
  const ctx = await b.newContext({viewport:{width:1366,height:900}});
  const p = await ctx.newPage();
  const errors=[]; p.on('pageerror',e=>errors.push(e.message)); p.on('console',m=>{if(m.type()==='error'&&!/ERR_FAILED/.test(m.text()))errors.push(m.text())});
  await p.route(/fonts\.(googleapis|gstatic)/, r=>r.abort());
  await p.goto('file://'+path); await p.waitForTimeout(400);
  ok('page loads, card rendered', await p.locator('#card .cardhead').count()===1);
  ok('4 track buttons', await p.locator('.track').count()===4);
  ok('4 mode buttons', await p.locator('.mode').count()===4);

  // data integrity
  const integ = await p.evaluate(()=>{const bad=[];const ids=new Set();for(const q of BANK){if(ids.has(q.id))bad.push('dup '+q.id);ids.add(q.id);
    if(q.type==='mcq'&&!(q.ans>=0&&q.ans<q.options.length))bad.push('ans '+q.id);
    if(q.type==='flash'&&!q.a)bad.push('flash '+q.id);
    for(const t of q.tags)if(!NOTES[t])bad.push('nonote '+q.id+':'+t);}return {n:BANK.length,bad}});
  ok(`question bank integrity (${integ.n} questions)`, integ.bad.length===0, integ.bad.join(', '));

  // reference solutions through real worker
  const sol = await p.evaluate(async()=>{const out=[];for(const q of BANK.filter(q=>q.type==='code')){const r=await runCode(q.solution,q.fn,q.tests);out.push([q.title,!r.error&&r.res.every(t=>t.ok),r.error||'']);}return out});
  for(const [t,pass,e] of sol) ok('reference solution passes: '+t, pass, e);
  const starter = await p.evaluate(async()=>{const q=BANK.find(q=>q.id==='d1');const r=await runCode(q.starter,q.fn,q.tests);return r.res&&r.res.every(t=>!t.ok)});
  ok('empty starter code fails tests (no false pass)', starter);

  // MCQ correct
  async function loadQ(id){await p.evaluate(id=>load(byId(id),[['test','']]),id)}
  await loadQ('d10');
  ok('Next hidden + Skip visible before answering', !(await p.isVisible('#nextBtn')) && await p.isVisible('#skipBtn'));
  const r0=+await p.textContent('#rating');
  await p.click('.opt[data-i="1"]');
  ok('MCQ correct → green + verdict', await p.locator('.opt.right').count()===1 && /Nailed|Correct|Clean|That/.test(await p.textContent('.verdict')));
  const r1=+await p.textContent('#rating'); ok('rating goes up on correct', r1>r0, `${r0}→${r1}`);
  ok('after answering: Next shown, Skip hidden', await p.isVisible('#nextBtn') && !(await p.isVisible('#skipBtn')));
  // MCQ wrong
  await loadQ('d14'); await p.click('.opt[data-i="0"]');
  ok('MCQ wrong → red + correct highlighted', await p.locator('.opt.wrong').count()===1 && await p.locator('.opt.right').count()===1);
  const r2=+await p.textContent('#rating'); ok('rating goes down on wrong', r2<r1, `${r1}→${r2}`);
  ok('wrong answer queued for review', await p.evaluate(()=>S.review.d14!==undefined));
  ok('options locked after answering', await p.locator('.opt:disabled').count()===4);

  // flashcard
  await p.click('.track[data-t="cpp"]'); await loadQ('c1');
  await p.click('#flipBtn'); await p.waitForTimeout(100);
  ok('flashcard flips', await p.locator('#flip.on').count()===1);
  ok('4 self-grade buttons appear', await p.locator('[data-g]').count()===4);
  await p.click('[data-g="1"]'); ok('flashcard grading gives feedback', await p.locator('.verdict').count()===1);
  ok('C++ track level label', (await p.textContent('#lvlTrack')).startsWith('C++'));

  // code: correct, wrong, syntax error, infinite loop, show solution
  await p.click('.track[data-t="dsa"]'); await loadQ('d7');
  await p.fill('#code','function climbStairs(n){ return n; }'); await p.click('#runBtn'); await p.waitForSelector('.test');
  ok('wrong code → failing tests shown, not graded', await p.locator('.test.no').count()>0 && await p.locator('.verdict').count()===0);
  await p.fill('#code','function climbStairs(n {'); await p.click('#runBtn'); await p.waitForTimeout(300);
  ok('syntax error reported', /Syntax error/.test(await p.textContent('#tests')));
  await p.fill('#code','function climbStairs(n){ while(true){} }'); const t0=Date.now(); await p.click('#runBtn'); await p.waitForFunction(()=>/Timed out/.test(document.querySelector('#tests').textContent),null,{timeout:5000});
  ok('infinite loop killed by timeout', true, ((Date.now()-t0)/1000).toFixed(1)+'s');
  await p.fill('#code',await p.evaluate(()=>cur.solution)); await p.click('#runBtn'); await p.waitForSelector('.verdict');
  ok('correct code → all tests pass + graded', await p.locator('.test.ok').count()===4);
  ok('Tab key indents in editor', await (async()=>{await loadQ('d2');await p.click('#code');await p.keyboard.press('End');await p.keyboard.press('Tab');return (await p.inputValue('#code')).includes('  ')})());
  await p.click('#solBtn'); ok('show solution reveals code + counts as miss', await p.locator('pre.sol').count()===1 && await p.evaluate(()=>S.review.d2!==undefined));

  // modes
  for (const m of ['mcq','flash','code','mix']) {
    await p.click(`.mode[data-m="${m}"]`); await p.waitForTimeout(50);
    const ty = await p.evaluate(()=>cur.type);
    ok(`mode "${m}" serves matching type`, m==='mix'||ty===m, ty);
  }
  // mode with no questions in a track → fallback
  await p.click('.mode[data-m="code"]'); await p.click('.track[data-t="cpp"]'); await p.waitForTimeout(50);
  ok('C++ has no code questions → resets to Smart mix', await p.evaluate(()=>S.mode==='mix'&&cur.track==='cpp'));
  ok('Code mode disabled on C++ track', await p.locator('.mode[data-m="code"]:disabled').count()===1);
  ok('mode buttons show question counts', /\d/.test(await p.textContent('.mode[data-m="flash"]')));
  for (const t of ['dsa','ml','cpp','cs']){await p.click(`.track[data-t="${t}"]`);for(const m of ['mcq','flash','code']){const b=p.locator(`.mode[data-m="${m}"]`);if(await b.isDisabled())continue;await b.click();if(!(await p.evaluate(m=>cur.type===m,m)))ok(`track ${t} mode ${m}`,false);}}
  ok('every enabled track × mode combo serves the right type', true);

  // tracks serve right track
  for (const t of ['dsa','ml','cpp','cs']){await p.click(`.track[data-t="${t}"]`);ok(`track ${t} serves its questions`, await p.evaluate(t=>cur.track===t,t));}

  // tag drill, similar, notes
  await p.click('.track[data-t="dsa"]');
  const tag = await p.getAttribute('.bar >> nth=0','data-tag'); await p.click('.bar >> nth=0');
  ok('mastery bar drills that topic', await p.evaluate(t=>cur.tags.includes(t),tag), tag);
  ok('similar list populated', await p.locator('.simitem').count()>0);
  const sid = await p.getAttribute('.simitem >> nth=0','data-id'); await p.click('.simitem >> nth=0');
  ok('clicking similar loads it', await p.evaluate(id=>cur.id===id,sid));
  ok('notes shown for topic', await p.locator('#notes li').count()>0);

  // picker variety: 30 nexts, no immediate repeats
  const seq = await p.evaluate(()=>{const s=[];for(let i=0;i<30;i++){next();s.push(cur.id)}return s});
  let rep=0; for(let i=1;i<seq.length;i++) if(seq[i]===seq[i-1]) rep++;
  ok('picker never repeats same question back-to-back', rep===0, new Set(seq).size+' distinct of 30');

  // review flow
  await p.evaluate(()=>{S.review={d14:0};renderSide()});
  ok('review counter shows due', (await p.textContent('#dueN'))==='1');
  await p.click('#reviewBtn'); ok('Review now loads the due mistake', await p.evaluate(()=>cur.id==='d14'));

  // skip
  const before = await p.evaluate(()=>cur.id); await p.click('#skipBtn'); ok('Skip moves on', await p.evaluate(b=>cur.id!==b,before));

  // AI buttons outside Claude → graceful toast
  for (const sel of ['#hintBtn','#cheatBtn','[data-twin="same"]']) {
    await p.evaluate(()=>{document.querySelector('#toast').textContent=''}); await p.click(sel); await p.waitForTimeout(150);
    ok(`AI button ${sel} degrades gracefully outside Claude`, /Claude access/.test(await p.textContent('#toast')));
  }

  // goal ring, xp, accuracy
  ok('XP / accuracy / goal updated', +(await p.textContent('#xp'))>0 && /%/.test(await p.textContent('#acc')) && +(await p.textContent('#goalXp'))>0);
  ok('sparkline drawn', await p.locator('#spark polyline').count()===1);

  // persistence
  const saved = await p.evaluate(()=>({xp:S.xp,r:S.ratings.dsa}));
  await p.reload(); await p.waitForTimeout(300);
  const after = await p.evaluate(()=>({xp:S.xp,r:S.ratings.dsa}));
  ok('progress survives reload (localStorage)', saved.xp===after.xp && saved.r===after.r, JSON.stringify(after));

  ok('no JS errors in console', errors.length===0, errors.join(' | '));
  await p.screenshot({path:shots+'/desktop.png'});


  /* ===================== v1.2 features ===================== */
  const q2 = await ctx.newPage(); const e2=[]; q2.on('pageerror',e=>e2.push(e.message));
  await q2.route(/fonts\.(googleapis|gstatic)/, r=>r.abort());
  await q2.goto('file://'+path); await q2.evaluate(()=>{localStorage.clear()}); await q2.reload(); await q2.waitForTimeout(300);
  const L2 = id=>q2.evaluate(id=>load(byId(id),[['test','']]),id);

  // MCQ shuffle: correct answer must not sit in a fixed slot
  const slots = await q2.evaluate(()=>{const seen=new Set();for(let i=0;i<40;i++){load(byId('d10'),[]);seen.add(curOrder.indexOf(cur.ans))}return [...seen]});
  ok('MCQ options are shuffled (answer appears in several slots)', slots.length>=3, 'slots '+slots.join(','));
  const bias = await q2.evaluate(()=>{const c=[0,0,0,0];for(const q of BANK.filter(q=>q.type==='mcq'))for(let i=0;i<50;i++){load(q,[]);c[curOrder.indexOf(q.ans)]++}return c});
  ok('answer position no longer favours B', Math.max(...bias)/bias.reduce((a,b)=>a+b) < 0.32, 'A/B/C/D '+bias.join('/'));
  await L2('d10'); await q2.click(`.opt[data-i="${await q2.evaluate(()=>cur.ans)}"]`);
  ok('shuffled MCQ still grades the right option correct', await q2.locator('.opt.right').count()===1 && await q2.locator('.opt.wrong').count()===0);
  ok('AI hint context lists options in displayed order', await q2.evaluate(()=>{load(byId('d11'),[]);const c=qContext(cur);return c.includes('A) '+cur.options[curOrder[0]])}));

  // keyboard
  await L2('d13'); const pos = await q2.evaluate(()=>curOrder.indexOf(cur.ans));
  await q2.locator('body').click({position:{x:5,y:5}}); await q2.keyboard.press(String(pos+1));
  ok('key 1–4 answers an MCQ', await q2.locator('.opt.right').count()===1 && await q2.locator('.opt.wrong').count()===0);
  await q2.locator('body').click({position:{x:5,y:5}}); const bef=await q2.evaluate(()=>cur.id); await q2.keyboard.press('Enter');
  ok('Enter goes to the next question', await q2.evaluate(b=>cur.id!==b&&!answered,bef));
  await L2('d10'); await q2.locator('body').click({position:{x:5,y:5}}); await q2.keyboard.press('b');
  ok('letter keys A–D answer an MCQ', await q2.evaluate(()=>answered));
  await L2('c1'); await q2.locator('body').click({position:{x:5,y:5}}); await q2.keyboard.press(' ');
  ok('Space flips a flashcard', await q2.locator('#flip.on').count()===1);
  ok('flipped answer exposed to screen readers, prompt hidden', await q2.evaluate(()=>!document.querySelector('#flip .back').hasAttribute('aria-hidden')&&document.querySelector('#flip .front').getAttribute('aria-hidden')==='true'));
  await q2.keyboard.press(' '); ok('second Space does not auto-grade the card', await q2.evaluate(()=>!answered));
  await q2.keyboard.press('4'); ok('key 4 rates a flashcard "Easy"', await q2.evaluate(()=>answered) && /Locked in/.test(await q2.textContent('#fb')));
  await L2('c2'); ok('unflipped flashcard answer hidden from screen readers', await q2.evaluate(()=>document.querySelector('#flip .back').getAttribute('aria-hidden')==='true'));
  await L2('d7'); await q2.fill('#code', await q2.evaluate(()=>cur.solution)); await q2.focus('#code'); await q2.keyboard.press('Control+Enter'); await q2.waitForSelector('.verdict',{timeout:4000});
  ok('Ctrl+Enter runs code tests', await q2.locator('.test.ok').count()===4);
  await L2('d12'); await q2.locator('body').click({position:{x:5,y:5}}); const sk=await q2.evaluate(()=>cur.id); await q2.keyboard.press('s');
  ok('S skips', await q2.evaluate(b=>cur.id!==b,sk));
  ok('shortcut hint shown for current format', /Keys:/.test(await q2.textContent('#keys')));

  // tolerant checker
  const tol = await q2.evaluate(async()=>{
    const r1=await runCode('function f(){return [0.1+0.2, 1/3]}','f',[[[],[0.3,0.3333333333]]]);
    const r2=await runCode('function f(){return 0.301}','f',[[[],0.3]]);
    const r3=await runCode('function f(){return {b:2,a:1}}','f',[[[],{a:1,b:2}]]);
    const r4=await runCode('function f(){return {a:1}}','f',[[[],{a:1,b:2}]]);
    const r5=await runCode('function f(){return [1,2]}','f',[[[],[1,2,3]]]);
    const r6=await runCode('function f(){return "1"}','f',[[[],1]]);
    const r7=await runCode('function f(x){return x}','f',[["notarray",1]]);
    return [r1.res[0].ok,!r2.res[0].ok,r3.res[0].ok,!r4.res[0].ok,!r5.res[0].ok,!r6.res[0].ok,!r7.res[0].ok&&/must be an array/.test(r7.res[0].out)]});
  ok('checker accepts tiny float error (0.1+0.2 vs 0.3)', tol[0]);
  ok('checker rejects real numeric mistakes', tol[1]);
  ok('checker compares objects regardless of key order', tol[2]);
  ok('checker rejects missing keys / wrong length / wrong type', tol[3]&&tol[4]&&tol[5]);
  ok('checker reports malformed tests instead of crashing', tol[6]);

  // code coverage across tracks
  const modes = await q2.evaluate(()=>['dsa','ml','cpp','cs'].map(t=>[t,all().filter(q=>q.track===t&&q.type==='code').length]));
  ok('ML and CS tracks now have code problems', modes[1][1]>=7&&modes[3][1]>=4, JSON.stringify(modes));
  await q2.click('.track[data-t="ml"]'); ok('Code mode enabled on ML', !(await q2.locator('.mode[data-m="code"]').isDisabled()));
  await q2.click('.mode[data-m="code"]'); ok('ML code mode serves an ML code problem', await q2.evaluate(()=>cur.track==='ml'&&cur.type==='code'));
  await q2.click('.track[data-t="cpp"]'); ok('Code mode still disabled on C++ (no runner)', await q2.locator('.mode[data-m="code"]').isDisabled());
  await q2.click('.track[data-t="dsa"]'); await q2.click('.mode[data-m="mix"]');

  // mastery "new"
  await q2.evaluate(()=>{localStorage.clear();S=fresh();renderSide()});
  ok('untried topics show "new", not a fake 50%', await q2.locator('.bar .new').count()===await q2.locator('.bar').count() && !(await q2.textContent('#bars')).includes('50%'));
  await L2('d10'); await q2.click(`.opt[data-i="${await q2.evaluate(()=>cur.ans)}"]`);
  ok('answered topic shows a real percentage', /BinarySearch\d+%/.test((await q2.textContent('#bars')).replace(/\s/g,'')));

  // spaced repetition
  const srs = await q2.evaluate(()=>({box:S.box.d10,due:S.srs.d10,ans:S.answered}));
  ok('correct answer scheduled for a spaced refresh', srs.box===1&&srs.due===srs.ans+9, JSON.stringify(srs));
  const refreshed = await q2.evaluate(()=>{S.answered=S.srs.d10;S.recent=S.recent.filter(x=>x!=='d10').concat(['d10','d11','d12','d13','d14']).slice(-8);S.mode='mcq';const p=pool();const r=[];for(let i=0;i<80;i++){cur=null;const x=pick();if(x.q.id==='d10')r.push(x.why.map(w=>w[0]).join('|'))}S.mode='mix';return r});
  ok('due refresh comes back with a "Spaced refresh" reason', refreshed.some(w=>/Spaced refresh/.test(w)), refreshed.length+' of 80 picks');
  await q2.evaluate(()=>load(byId('d14'),[])); await q2.click(`.opt[data-i="${await q2.evaluate(()=>(cur.ans+1)%4)}"]`);
  ok('wrong answer resets its box and queues review', await q2.evaluate(()=>S.box.d14===0&&S.review.d14!==undefined&&S.srs.d14===undefined));

  // skip penalty
  const skipTest = await q2.evaluate(()=>{S.mode='mcq';S.recent=[];load(byId('d11'),[]);S.skips.d11=S.answered;const ids=[];for(let i=0;i<3;i++){next();ids.push(cur.id)}S.mode='mix';return ids});
  ok('a skipped question does not bounce straight back', !skipTest.includes('d11'), skipTest.join(','));

  // format variety in Smart mix
  const variety = await q2.evaluate(()=>{S.mode='mix';const t=[];for(let i=0;i<40;i++){next();t.push(cur.type)}let run=1,maxRun=1;for(let i=1;i<t.length;i++){run=t[i]===t[i-1]?run+1:1;maxRun=Math.max(maxRun,run)}return {maxRun,kinds:new Set(t).size}});
  ok('Smart mix varies formats (no long same-type runs)', variety.maxRun<=3&&variety.kinds===3, JSON.stringify(variety));

  // streak + local dates
  const streak = await q2.evaluate(()=>{const r={};S.streak=5;S.lastActive='2000-01-01';renderSide();r.old=$('#streak').textContent;
    S.lastActive=yesterday();renderSide();r.y=$('#streak').textContent+' '+$('#streakU').textContent;
    load(byId('d13'),[]);grade(1);r.after=S.streak+' '+$('#streakU').textContent;
    S.streak=1;renderSide();r.one=$('#streakU').textContent;return r});
  ok('broken streak shows 0 instead of the old number', streak.old==='0');
  ok('yesterday\'s streak still counts and grows today', streak.y==='5 days'&&streak.after==='6 days', JSON.stringify(streak));
  ok('"1 day" singular / "days" plural', streak.one==='day');

  // backup: export / import
  const bk0 = await q2.evaluate(()=>({xp:S.xp,answered:S.answered,r:S.ratings.dsa,seen:Object.keys(S.seen).length}));
  const [dl] = await Promise.all([q2.waitForEvent('download'), q2.click('#exportBtn')]);
  const backup = await require('fs').promises.readFile(await dl.path(),'utf8'); const bj = JSON.parse(backup);
  ok('export downloads a dated JSON backup', /^grindstone-progress-\d{4}-\d{2}-\d{2}\.json$/.test(dl.suggestedFilename()) && bj.app==='grindstone' && bj.state.xp===bk0.xp, dl.suggestedFilename());
  await q2.evaluate(()=>{S=fresh();save();renderSide()});
  const imp = buf=>q2.setInputFiles('#importFile',{name:'b.json',mimeType:'application/json',buffer:Buffer.from(buf)});
  await imp(backup); await q2.waitForTimeout(150);
  const restored = await q2.evaluate(()=>({xp:S.xp,answered:S.answered,r:S.ratings.dsa,seen:Object.keys(S.seen).length,ls:JSON.parse(localStorage.getItem(KEY)).xp,ui:$('#xp').textContent}));
  ok('import restores progress, saves it and updates the UI', restored.xp===bk0.xp&&restored.answered===bk0.answered&&restored.r===bk0.r&&restored.seen===bk0.seen&&restored.ls===bk0.xp&&restored.ui===String(bk0.xp), JSON.stringify(restored));
  ok('import toast confirms the restore', /restored/i.test(await q2.textContent('#toast')));
  await imp('{not json'); await q2.waitForTimeout(100);
  ok('invalid JSON is rejected and progress kept', /valid JSON/.test(await q2.textContent('#toast')) && await q2.evaluate(x=>S.xp===x,bk0.xp));
  await imp(JSON.stringify({hello:'world'})); await q2.waitForTimeout(100);
  ok('non-Grindstone JSON is rejected', /doesn't look like/.test(await q2.textContent('#toast')) && await q2.evaluate(x=>S.xp===x,bk0.xp));
  const clean = await q2.evaluate(()=>{const s=parseBackup(JSON.stringify({app:'grindstone',state:{ratings:{dsa:'abc',ml:99999},xp:'lots',track:'zzz',mode:'weird',seen:[1,2],
    gen:[{id:'g1',track:'dsa',type:'mcq',q:'?',tags:['DP'],diff:1000,options:['a','b'],ans:5},{id:'g2',track:'ml',type:'flash',q:'Q',a:'A',tags:['Basics'],diff:900},{id:'d1',track:'dsa',type:'flash',q:'Q',a:'A',tags:[],diff:900}]}}));
    return {dsa:s.ratings.dsa,ml:s.ratings.ml,cpp:s.ratings.cpp,xp:s.xp,track:s.track,mode:s.mode,seen:Array.isArray(s.seen),gen:s.gen.map(q=>q.id)}});
  ok('import sanitises bad fields, clamps ratings and drops broken twins', clean.dsa===1000&&clean.ml===3000&&clean.cpp===1000&&clean.xp===0&&clean.track==='dsa'&&clean.mode==='mix'&&!clean.seen&&clean.gen.join()==='g2', JSON.stringify(clean));

  // reset
  await q2.click('#resetBtn');
  ok('first Reset click only asks to confirm', /Tap again/.test(await q2.textContent('#resetBtn')) && await q2.evaluate(()=>S.answered>0));
  await q2.click('#resetBtn');
  ok('second Reset click erases progress', await q2.evaluate(()=>S.answered===0&&S.xp===0&&Object.keys(S.seen).length===0) && (await q2.textContent('#xp'))==='0');
  await q2.reload(); await q2.waitForTimeout(200);
  ok('reset survives a reload', await q2.evaluate(()=>S.answered===0));
  ok('no JS errors (feature pass)', e2.length===0, e2.join(' | '));
  await q2.close();

  /* ===================== timezone (IST) ===================== */
  const tzc = await b.newContext({timezoneId:'Asia/Kolkata'}); const tz = await tzc.newPage();
  await tz.clock.install({time:new Date('2026-11-03T20:00:00Z')}); // 01:30 on 4 Nov in India, still 3 Nov in UTC
  await tz.route(/fonts\./,r=>r.abort()); await tz.goto('file://'+path); await tz.waitForTimeout(100);
  const d = await tz.evaluate(()=>({t:today(),y:yesterday()}));
  ok('day rolls over at local midnight (IST), not UTC', d.t==='2026-11-04'&&d.y==='2026-11-03', JSON.stringify(d));
  await tzc.close();

  /* ===================== AI features with a mock Claude ===================== */
  const mc = await b.newContext(); const ai = await mc.newPage(); const e3=[]; ai.on('pageerror',e=>e3.push(e.message));
  await ai.addInitScript(()=>{
    window.__mock={delay:0,text:'Think about halving the range.',json:null,calls:[]};
    const sample=(input,opts={})=>new Promise((res,rej)=>{__mock.calls.push(String(input).slice(0,80));
      const t=setTimeout(()=>{if(opts.signal&&opts.signal.aborted)return rej({code:'cancelled'});opts.onText&&opts.onText({text:__mock.text,delta:__mock.text});res({text:__mock.text,truncated:false})},__mock.delay);
      if(opts.signal)opts.signal.addEventListener('abort',()=>{clearTimeout(t);rej({code:'cancelled'})})});
    sample.json=(input,opts={})=>new Promise(res=>setTimeout(()=>res(JSON.parse(JSON.stringify(__mock.json))),__mock.delay));
    window.claude={use:async n=>n==='sample'?sample:null};
  });
  await ai.route(/fonts\./,r=>r.abort()); await ai.goto('file://'+path); await ai.evaluate(()=>localStorage.clear()); await ai.reload(); await ai.waitForTimeout(200);
  const LA = id=>ai.evaluate(id=>load(byId(id),[]),id);
  await LA('d10'); await ai.click('#hintBtn'); await ai.waitForFunction(()=>/halving/.test(document.querySelector('#aiOut').textContent));
  ok('AI hint streams into the card', true);
  await ai.click('#cheatBtn'); await ai.waitForFunction(()=>/halving/.test(document.querySelector('#notes').textContent));
  ok('AI cheat sheet renders in notes', true);
  await LA('d7'); await ai.click('#reviewAi'); await ai.waitForFunction(()=>/halving/.test(document.querySelector('#aiOut').textContent));
  ok('AI code review renders', true);
  // hint cancelled when moving on
  await ai.evaluate(()=>{__mock.delay=400}); await LA('d10'); await ai.click('#hintBtn'); await ai.click('#skipBtn'); await ai.waitForTimeout(600);
  ok('pending AI hint does not leak onto the next question', (await ai.textContent('#aiOut')).trim()==='');
  // MCQ twin
  await ai.evaluate(()=>{__mock.delay=0;__mock.json={q:'Twin: complexity of searching a sorted array by halving?',options:['O(n)','O(1)','O(log n)','O(n²)'],ans:2,explain:'Halves each step.'}});
  await LA('d10'); await ai.click('[data-twin="harder"]'); await ai.waitForFunction(()=>cur&&cur.ai);
  const tw = await ai.evaluate(()=>({type:cur.type,parent:cur.parent,diff:cur.diff,ans:cur.ans,n:S.gen.length}));
  ok('MCQ twin generated, linked to original, harder', tw.type==='mcq'&&tw.parent==='d10'&&tw.diff===1000&&tw.n===1, JSON.stringify(tw));
  await ai.click(`.opt[data-i="2"]`); ok('MCQ twin grades correctly', await ai.locator('.opt.right').count()===1&&await ai.locator('.opt.wrong').count()===0);
  // flash twin
  await ai.evaluate(()=>{__mock.json={q:'Twin: what is a vtable?',a:'Table of virtual function pointers.'}}); await LA('c3'); await ai.click('[data-twin="same"]'); await ai.waitForFunction(()=>cur&&cur.ai&&cur.type==='flash');
  ok('flashcard twin generated', await ai.evaluate(()=>cur.parent==='c3'));
  // code twin good
  await ai.evaluate(()=>{__mock.json={title:'Tribonacci Stairs',q:'Steps of 1, 2 or 3.',fn:'ways',starter:'function ways(n) {\n}',solution:'function ways(n){const d=[1,1,2];for(let i=3;i<=n;i++)d[i]=d[i-1]+d[i-2]+d[i-3];return d[n]}',tests:[[[3],4],[[4],7],[[5],13],[[1],1]],explain:'Sum of last three.'}});
  await LA('d7'); await ai.click('[data-twin="harder"]'); await ai.waitForFunction(()=>cur&&cur.ai&&cur.type==='code',null,{timeout:5000});
  ok('verified code twin is served', await ai.evaluate(()=>cur.fn==='ways'&&cur.parent==='d7'));
  // code twin with broken solution is discarded
  await ai.evaluate(()=>{__mock.json={title:'Bad',q:'x',fn:'bad',starter:'function bad(){}',solution:'function bad(n){return n}',tests:[[[1],2]],explain:''}});
  await LA('d7'); await ai.click('[data-twin="same"]'); await ai.waitForFunction(()=>/discarded/.test(document.querySelector('#twinNote').textContent),null,{timeout:5000});
  ok('code twin that fails its own tests is discarded', await ai.evaluate(()=>cur.id==='d7'));
  // malformed MCQ JSON rejected
  await ai.evaluate(()=>{__mock.json={q:'x',options:['a'],ans:5}}); await LA('d10'); await ai.click('[data-twin="same"]'); await ai.waitForTimeout(150);
  ok('malformed twin JSON rejected with a message', await ai.evaluate(()=>cur.id==='d10') && /right shape/.test(await ai.textContent('#twinNote')));
  // twin built from the original even if you move on
  await ai.evaluate(()=>{__mock.delay=300;__mock.json={q:'Twin of BST inorder',options:['a','b','c','d'],ans:0,explain:''}});
  await LA('d13'); await ai.click('[data-twin="same"]'); await LA('m1'); await ai.waitForFunction(()=>cur&&cur.ai&&cur.q.startsWith('Twin of BST'),null,{timeout:3000});
  ok('twin keeps the original question\'s track and tags after you move on', await ai.evaluate(()=>cur.parent==='d13'&&cur.track==='dsa'&&cur.tags.join()==='Trees'));
  ok('twins persist across reload', await (async()=>{await ai.reload();await ai.waitForTimeout(200);return ai.evaluate(()=>S.gen.length===4)})());
  ok('no JS errors (AI pass)', e3.length===0, e3.join(' | '));
  await mc.close();

  // mobile
  const m = await b.newPage({viewport:{width:390,height:844}}); const merr=[]; m.on('pageerror',e=>merr.push(e.message));
  await m.route(/fonts\.(googleapis|gstatic)/, r=>r.abort());
  await m.goto('file://'+path); await m.waitForTimeout(300);
  const ov = await m.evaluate(()=>document.documentElement.scrollWidth-window.innerWidth);
  ok('mobile 390px: no horizontal scroll', ov<=0, 'overflow '+ov+'px');
  await m.evaluate(()=>load(byId('d6'),[]));
  const ov2 = await m.evaluate(()=>document.documentElement.scrollWidth-window.innerWidth);
  ok('mobile: code question fits', ov2<=0, 'overflow '+ov2+'px');
  ok('mobile: practice card is first', await m.evaluate(()=>document.querySelector('.stage').getBoundingClientRect().top < document.querySelector('.left').getBoundingClientRect().top));
  await m.screenshot({path:shots+'/mobile.png',fullPage:false});
  ok('mobile: no JS errors', merr.length===0, merr.join('|'));
  await b.close();
  console.log(results.join('\n')); console.log('\n'+results.filter(r=>r.startsWith('PASS')).length+'/'+results.length+' passed');
})().catch(e=>{console.log(results.join('\n'));console.error('CRASH',e);process.exit(1)}).then(()=>{if(results.some(r=>r.startsWith('FAIL')))process.exitCode=1});
