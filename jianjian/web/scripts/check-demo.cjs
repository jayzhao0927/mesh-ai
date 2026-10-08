const { chromium } = require('playwright');
const assert = require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_EXECUTABLE?{executablePath:process.env.CHROMIUM_EXECUTABLE,args:['--no-sandbox','--disable-dev-shm-usage','--disable-gpu','--disable-software-rasterizer','--no-zygote','--single-process']}: {})});
 const page=await browser.newPage({viewport:{width:1180,height:900}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(process.env.WEB_TEST_URL || 'http://127.0.0.1:5173/try');await page.getByText('很高兴，见到你。').waitFor();

 await page.getByPlaceholder('你的昵称').fill('体验用户');await page.getByRole('button',{name:'开始认识我'}).click();
 async function text(v){const before=await page.locator('.bubble').last().innerText();await page.getByPlaceholder('简单说说',{exact:true}).fill(v);await page.getByRole('button',{name:'发送',exact:true}).click();await page.waitForFunction(previous=>Array.from(document.querySelectorAll('.bubble')).at(-1)?.textContent!==previous,before);}
 async function pick(v){await page.getByRole('button',{name:v,exact:true}).click();}
 await text('上海');await text('36');await pick('男生');await pick('稳定恋爱');await pick('常联系，也各有空间');
 await pick('摄影');await pick('做饭');await pick('就这些');await pick('宅家');await text('杭州');await text('设计师');await pick('两个人一起规划');await pick('温和安静');await pick('安静吃顿饭');await pick('认真听我说话');await pick('阳光开朗');await pick('温和委婉');await pick('先冷静，再好好聊');
 await page.getByRole('button',{name:'换个随机场景'}).waitFor();

 assert(!/\p{Decimal_Number}/u.test(await page.locator('.scene-card').innerText()));
 await page.getByRole('button',{name:/模拟明天/}).click();await page.getByText('AI 推演样例 · 一方受委屈',{exact:true}).waitFor();await page.getByRole('button',{name:/跳到揭晓/}).click();
 await page.getByRole('button',{name:'感兴趣',exact:true}).waitFor();
 assert(!/\p{Decimal_Number}/u.test(await page.locator('.rec').innerText()));
 await pick('感兴趣');await page.getByRole('button',{name:/模拟双方都感兴趣/}).click();
 await page.locator('input[type="datetime-local"]').fill('2026-10-09T18:00');await pick('预约视频');await pick('进入房间');await page.getByText('样例房间，不会连接其他人。').waitFor();
 await page.getByPlaceholder('想到什么，都可以告诉我…').fill('把城市改成杭州');await page.getByRole('button',{name:'发送消息'}).click();await page.getByText('好，已经按你说的改好了。').waitFor();
 await page.getByPlaceholder('想到什么，都可以告诉我…').fill('删除年龄');await page.getByRole('button',{name:'发送消息'}).click();await page.getByText('好，这条资料已经删掉了。').waitFor();
 const state=await page.evaluate(()=>JSON.parse(localStorage.getItem('jj.try.state')));assert.equal(state.profile.data.stated.city.value,'杭州');assert.equal(state.profile.data.stated.age,undefined);
 await page.setViewportSize({width:375,height:812});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 assert.deepEqual(errors,[]);console.log('PASS: demo registration, basics, goal, onboarding, scenes, single zero-digit card, mutual preview, room stub, chat profile edit/delete, mobile overflow');
 await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});
