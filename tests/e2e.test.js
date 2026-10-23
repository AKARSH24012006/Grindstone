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
  await p.click('.mode[data-m="code"]'); await p.click('.track[data-t="ml"]'); await p.waitForTimeout(50);
  ok('ML has no code questions → resets to Smart mix', await p.evaluate(()=>S.mode==='mix'&&cur.track==='ml'));
  ok('Code mode disabled on ML track', await p.locator('.mode[data-m="code"]:disabled').count()===1);
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
