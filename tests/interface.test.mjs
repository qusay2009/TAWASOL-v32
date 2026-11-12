import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
test('private UI routes render, unknown names stay hidden, and audio renders protected URLs',()=>{
const nodes=new Map();
function node(){return {innerHTML:'',style:{},classList:{add(){},remove(){},toggle(){}},querySelector(){return null},querySelectorAll(){return []},insertAdjacentHTML(){},remove(){},append(){},showModal(){this.open=true},close(){this.open=false},addEventListener(){},getContext(){return {clearRect(){},beginPath(){},arc(){},fill(){},stroke(){},moveTo(){},lineTo(){},setTransform(){}}}}}
const ctx={console,structuredClone,crypto:globalThis.crypto,performance:globalThis.performance,devicePixelRatio:1,innerWidth:1024,innerHeight:768,addEventListener(){},removeEventListener(){},URL,Blob,FileReader:class{},setTimeout(){},clearTimeout(){},setInterval(){},clearInterval(){},matchMedia(){return {matches:false}},requestAnimationFrame(){},Date,localStorage:{getItem(){return null},setItem(){}},sessionStorage:{getItem(){return '1'},setItem(){}},location:{hash:''},navigator:{},document:{body:node(),querySelector(s){if(s==='#chatScroll')return null;if(!nodes.has(s))nodes.set(s,node());return nodes.get(s)},querySelectorAll(){return []},createElement:node,addEventListener(){}},window:{addEventListener(){},scrollTo(){},devicePixelRatio:1,innerWidth:1024,innerHeight:768},fetch:async()=>({ok:false,status:401,json:async()=>({error:'login'})})};
vm.createContext(ctx);vm.runInContext(readFileSync('index.html','utf8').split('<script>')[1].split('</script>')[0],ctx);
vm.runInContext(`
current='a';db={users:[{id:'a',name:'أحمد',email:'a@example.test',role:'user',following:['b'],active:true},{id:'b',name:'سارة',following:['a'],role:'user',active:true}],posts:[{id:'p',author:'b',text:'<script>alert(1)<\\/script>',likes:[],comments:[],time:Date.now(),music:{id:'m',name:'track'}}],messages:[{id:'x',from:'b',to:'a',audio:{id:'v'},time:Date.now()}],groups:[],notifications:[],reports:[],rooms:[],settings:{}};
for (const route of ['home','friends','search','profile','messages','notifications','groups','watch','settings']){page=route;profileId='a';render();if(!document.querySelector('#main').innerHTML)throw Error(route)}
page='home';render();if(!document.querySelector('#main').innerHTML.includes('/api/media/m'))throw Error('protected music missing');
if(document.querySelector('#main').innerHTML.includes('<script>alert'))throw Error('XSS');
if(document.querySelector('#right').innerHTML.includes('سارة'))throw Error('suggestion leak');
chatId='b';page='messages';render();if(!document.querySelector('#main').innerHTML.includes('تسجيل صوت'))throw Error('voice control missing');
db.users[1].following=[];render();if(document.querySelector('#main').innerHTML.includes('تسجيل صوت'))throw Error('non-friend composer');
`,ctx);
assert(true);
});
