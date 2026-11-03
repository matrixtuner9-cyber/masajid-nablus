/* Supabase adapter: gives the page the same db / user / assets / downloads interface it had inside Claude */
(function(){
const SB_URL='https://waeflhdjgxexwfawgfvh.supabase.co',SB_KEY='sb_publishable_AcZ7GEb6TXxkoWt4ua6Ahw_FEmA9mxG';
const DOMAIN='users.masajid-nablus.app';
const sb=window.supabase.createClient(SB_URL,SB_KEY,{auth:{persistSession:true,autoRefreshToken:true,storageKey:'masajid-auth'}});
window.SB=sb;window.SB_URL=SB_URL;
window.BLOB=SB_URL+'/storage/v1/object/public/photos/';
window.emailOf=u=>String(u||'').trim().toLowerCase()+'@'+DOMAIN;
window.APK_URL=SB_URL+'/storage/v1/object/public/app/masajid-nablus.apk';

const clone=o=>o==null?o:JSON.parse(JSON.stringify(o));
const parent=p=>p.replace(/\/[^/]+$/,'');
const last=p=>p.replace(/^.*\//,'');
const rid=()=>{const a=new Uint8Array(10);crypto.getRandomValues(a);return[...a].map(x=>x.toString(36).padStart(2,'0')).join('').slice(0,20)};
const snap=(id,d)=>({id,exists:d!=null,data:()=>clone(d)??undefined,metadata:{}});
const err=e=>{const m=(e&&e.message)||'';const c=e&&e.code;
  if(c==='P0002'||/missing/.test(m))return{code:'invalid_argument',message:'missing'};
  if(c==='42501'||/row-level security|permission/i.test(m))return{code:'permission_denied',message:m};
  return{code:c||'unavailable',message:m}};

/* live listeners, refreshed on realtime changes, after local writes, and every minute */
const L=new Set();let pend=new Set(),timer=0;
function kick(path){pend.add(path||'*');if(timer)return;timer=setTimeout(()=>{const ps=pend;pend=new Set();timer=0;
  for(const l of L){if(ps.has('*')||(l.doc?ps.has(l.path):[...ps].some(p=>parent(p)===l.path)))l.run()}},150)}
setInterval(()=>kick('*'),60000);
let chan=null;
function realtime(){if(chan)return;chan=sb.channel('docs-all').on('postgres_changes',{event:'*',schema:'public',table:'docs'},pl=>{kick((pl.new&&pl.new.path)||(pl.old&&pl.old.path))}).subscribe(st=>{if(st==='SUBSCRIBED')kick('*')})}
document.addEventListener('visibilitychange',()=>{if(!document.hidden)kick('*')});

function listen(o){const l={...o,seq:0};l.run=async()=>{const s=++l.seq;try{const r=await o.fetch();if(s===l.seq&&L.has(l))o.next(r)}catch(e){if(o.error)o.error(err(e))}};
  L.add(l);realtime();l.run();return()=>L.delete(l)}

function dref(path){
  return{id:last(path),path,
    async get(){const{data,error}=await sb.from('docs').select('data').eq('path',path).maybeSingle();if(error)throw err(error);return snap(last(path),data?data.data:null)},
    async set(d){const{error}=await sb.from('docs').upsert({path,coll:parent(path),id:last(path),data:clone(d)},{onConflict:'path'});if(error)throw err(error);kick(path)},
    async update(p){const{error}=await sb.rpc('doc_update',{p_path:path,p_patch:clone(p)});if(error)throw err(error);kick(path)},
    async delete(){const{error}=await sb.from('docs').delete().eq('path',path);if(error)throw err(error);kick(path)},
    onSnapshot(next,error){return listen({doc:true,path,next,error,fetch:()=>this.get()})},
    collection:c=>q(path+'/'+c)};
}
function q(path,f=[],ord=null,lim=0){
  async function run(){
    const all=[];const page=1000;
    for(let from=0;;from+=page){
      let x=sb.from('docs').select('id,data').eq('coll',path);
      for(const[k,op,v]of f){const col='data->>'+k;
        if(op==='==')x=v===null?x.is(col,null):x.eq(col,String(v));else if(op==='in')x=x.in(col,v.map(String));
        else if(op==='>=')x=x.gte(col,String(v));else if(op==='<=')x=x.lte(col,String(v));else if(op==='>')x=x.gt(col,String(v));else if(op==='<')x=x.lt(col,String(v));}
      x=ord?x.order('data->>'+ord[0],{ascending:ord[1]!=='desc'}).order('path'):x.order('path');
      const n=lim?Math.min(page,lim-all.length):page;
      const{data,error}=await x.range(from,from+n-1);if(error)throw err(error);
      all.push(...data);if(data.length<n||(lim&&all.length>=lim))break}
    const docs=all.map(r=>snap(r.id,r.data));return{docs,size:docs.length,empty:!docs.length,docChanges:()=>[]}}
  return{where:(k,op,v)=>q(path,[...f,[k,op,v]],ord,lim),orderBy:(k,d)=>q(path,f,[k,d||'asc'],lim),limit:n=>q(path,f,ord,n),
    doc:id=>dref(path+'/'+(id||rid())),get:run,
    async add(d){const r=dref(path+'/'+rid());await r.set(d);return r},
    onSnapshot(next,error){return listen({doc:false,path,next,error,fetch:run})}};
}
const db={doc:dref,collection:p=>q(p)};

let SESSION=null;
const user={id:async()=>SESSION.user.id,
  canEdit:async()=>{const{data}=await sb.rpc('is_admin');return!!data},
  isOwner:async()=>false,
  me:async()=>{const m=SESSION.user.user_metadata||{};return{id:SESSION.user.id,name:m.name||m.username||'',avatarUrl:'',username:m.username||''}}};
const hex=n=>{const a=new Uint8Array(n);crypto.getRandomValues(a);return[...a].map(x=>x.toString(16).padStart(2,'0')).join('')};
const assets={
  async upload(blob,o){const id=hex(16);const type=(o&&o.type)||blob.type||'image/jpeg';
    if(blob.size>8*1024*1024)throw{code:'too_large'};
    const{error}=await sb.storage.from('photos').upload(id,blob,{contentType:type,upsert:false,cacheControl:'31536000'});
    if(error)throw{code:/size/i.test(error.message)?'too_large':/mime|type/i.test(error.message)?'unsupported_type':'unavailable',message:error.message};
    return{id,url:window.BLOB+id,sizeBytes:blob.size,contentType:type}},
  async delete(id){const{data,error}=await sb.storage.from('photos').remove([id]);if(error)throw{code:'unavailable'};if(!data||!data.length)throw{code:'not_uploader'};return{deleted:true}},
  async list(){return{assets:[],usage:{}}}};
const downloads={async save({filename,data}){const b=data instanceof Blob?data:new Blob([data]);const u=URL.createObjectURL(b);const a=document.createElement('a');a.href=u;a.download=filename;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(u),4000);return{status:'saved'}}};

window.extAuth={
  async session(){const{data}=await sb.auth.getSession();SESSION=data.session;if(SESSION)sb.realtime.setAuth(SESSION.access_token);return SESSION},
  async login(username,password){const{data,error}=await sb.auth.signInWithPassword({email:emailOf(username),password});if(error)throw error;SESSION=data.session;return data.session},
  async setPassword(pw){const{error}=await sb.auth.updateUser({password:pw,data:{must_change:false}});if(error)throw error;await sb.auth.refreshSession();const s=await this.session();return s},
  async logout(){try{await sb.auth.signOut()}catch(e){}},
  async call(action,body){const s=await this.session();const r=await fetch(SB_URL+'/functions/v1/accounts',{method:'POST',headers:{'Content-Type':'application/json',apikey:SB_KEY,Authorization:'Bearer '+(s&&s.access_token)},body:JSON.stringify({action,...(body||{})})});const j=await r.json().catch(()=>({error:'network'}));if(!r.ok||j.error)throw j;return j}
};
sb.auth.onAuthStateChange((ev,s)=>{SESSION=s||SESSION;if(s)sb.realtime.setAuth(s.access_token)});
window.claude={use:async n=>n==='db'?db:n==='user'?user:n==='assets'?assets:n==='downloads'?downloads:null};
})();
