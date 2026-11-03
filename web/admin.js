/* لوحة الإدارة — تُحمَّل لحسابات الإدارة فقط */
function mergeReports(){const m=new Map();[...(S.reportsRecent||[]),...(S.reportsOpen||[])].forEach(r=>m.set(r.id,r));S.reports=[...m.values()].sort((a,b)=>(b.createdAt||'').localeCompare(a.createdAt||''));refresh()}
async function setRepStatus(r,st){const now=new Date().toISOString();await S.db.doc('org/main/rstatus/'+r.id).set({status:st,at:now});await S.db.doc('reports/'+r.id).update({status:st}).catch(()=>{})}
function adminLeaves(){
  return h('div',{style:'display:grid;gap:16px'},h('h2',null,'طلبات الإجازة والبديل'),dyn('lvBody',()=>{
    const all=[];S.staff.filter(s=>s.uid).forEach(s=>leavesOf(s.uid).forEach(l=>all.push({l,s})));
    const pend=all.filter(x=>!x.l.dec&&!x.l.cancelled),today=dkey(new Date());
    const cur=all.filter(x=>x.l.dec&&x.l.dec.status==='approved'&&!x.l.cancelled&&x.l.to>=today).sort((a,b)=>a.l.from.localeCompare(b.l.from));
    const past=all.filter(x=>!pend.includes(x)&&!cur.includes(x)).slice(0,40);
    const decide=(x,st)=>upsertMerge('outbox/'+x.s.uid,{leaves:{[x.l.id]:{status:st,note:String(S.lvNote[x.l.id]||'').trim(),at:new Date().toISOString()}}}).catch(onErr);
    const year=today.slice(0,4);
    return h('div',{style:'display:grid;gap:14px'},
      h('div',{class:'kpis'},h('div',{class:'kpi warn'},h('div',{class:'n'},pend.length),h('div',{class:'l'},'بانتظار الموافقة')),h('div',{class:'kpi'},h('div',{class:'n'},cur.filter(x=>x.l.from<=today).length),h('div',{class:'l'},'في إجازة اليوم')),h('div',{class:'kpi'},h('div',{class:'n'},cur.filter(x=>x.l.from>today).length),h('div',{class:'l'},'إجازات قادمة'))),
      h('h3',null,'بانتظار الموافقة'),
      pend.length?h('div',{class:'list'},pend.map(x=>h('div',{class:'item',style:'gap:8px'},leaveCard(x.l,true,x.s),
        h('p',{class:'small muted',style:'margin:0'},'استخدم '+usedDays(x.s.uid,'إجازة سنوية',year)+' يوم إجازة سنوية في '+year+'.'),
        h('input',{id:'lvn-'+x.l.id,placeholder:'ملاحظة للإمام (اختياري)',value:S.lvNote[x.l.id]||'',oninput:e=>{S.lvNote[x.l.id]=e.target.value}}),
        h('div',{class:'row'},h('button',{class:'btn sm',onclick:()=>decide(x,'approved')},'موافقة'),h('button',{class:'btn ghost sm',style:'color:var(--bad)',onclick:()=>decide(x,'rejected')},'رفض'))))):h('p',{class:'muted small',style:'margin:0'},'لا توجد طلبات جديدة.'),
      h('h3',null,'الإجازات الجارية والقادمة'),
      cur.length?h('div',{class:'list'},cur.map(x=>leaveCard(x.l,true,x.s))):h('p',{class:'muted small',style:'margin:0'},'لا توجد.'),
      past.length?h('details',null,h('summary',{class:'small'},'طلبات سابقة ('+past.length+')'),h('div',{class:'list',style:'margin-top:8px'},past.map(x=>leaveCard(x.l,true,x.s)))):null,
      h('div',{class:'panel'},h('h3',null,'رصيد الإجازات المعتمدة في '+year),h('div',{class:'tbl'},h('table',null,h('thead',null,h('tr',null,h('th',null,'الاسم'),h('th',null,'المسجد'),LEAVE_TYPES.map(t=>h('th',null,t)),h('th',null,'المجموع'))),
        h('tbody',null,S.staff.filter(s=>s.uid).map(s=>h('tr',null,h('td',null,s.name),h('td',null,mosque(s.mosqueId)?.name||''),LEAVE_TYPES.map(t=>h('td',{class:'num'},usedDays(s.uid,t,year))),h('td',{class:'num'},h('b',null,usedDays(s.uid,null,year))))))))));
  }));
}

async function ensureKeys(){
  if(!S.admin||!S.settingsLoaded||S.keyBusy)return;
  S.keyBusy=true;
  try{
    if(!(S.settings&&S.settings.pubKey)){
      const kp=await crypto.subtle.generateKey({name:'RSA-OAEP',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['encrypt','decrypt']);
      const pub=b64(await crypto.subtle.exportKey('spki',kp.publicKey)),priv=b64(await crypto.subtle.exportKey('pkcs8',kp.privateKey));
      await S.db.doc('org/keys/crypto/main').set({pkcs8:priv,createdAt:new Date().toISOString()});
      await saveSettings({pubKey:pub});
    }
    if(!S.privKey){const s=await S.db.doc('org/keys/crypto/main').get();if(s.exists)S.privKey=await crypto.subtle.importKey('pkcs8',unb64(s.data().pkcs8),{name:'RSA-OAEP',hash:'SHA-256'},false,['decrypt'])}
  }catch(e){onErr(e)}
  S.keyBusy=false;verifyPending();
}
async function saveSettings(patch){const ref=S.db.doc('org/main/settings/app');if(S.settings)await ref.update(patch);else await ref.set(patch);S.settings={...(S.settings||{}),...patch}}
const verifying=new Set();let verifyTimer=0;
function verifyPending(){clearTimeout(verifyTimer);verifyTimer=setTimeout(runVerify,400)}
async function runVerify(){
  if(!S.admin||!S.privKey)return;
  const docs=new Map();[...(S.dayDocs||[]),...(S.monthDocs||[])].forEach(d=>docs.set(d.id,d));
  for(const doc of docs.values()){
    const patch={};let n=0;
    for(const[dd,day]of Object.entries(doc.d||{}))for(const[k,rec]of Object.entries(day||{})){
      if(!rec||!rec.enc||rec.v!==undefined)continue;
      const key=doc.id+dd+k;if(verifying.has(key))continue;verifying.add(key);
      let ok=false,why='';
      try{
        const o=JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({name:'RSA-OAEP'},S.privKey,unb64(rec.enc))));
        const cd=S.codeDocs[doc.mosqueId]||{},at=Date.parse(rec.at);
        const codeOk=o.c===cd.code&&(!cd.since||Date.parse(cd.since)<=at+60e3)||(cd.prev||[]).some(p=>p.code===o.c&&Date.parse(p.until)>=at-60e3);
        if(o.u!==rec.by)why='سُجّل من حساب آخر';
        else if(rec.srv&&Math.abs(Date.parse(rec.srv)-at)>10*60e3)why='وقت الهاتف لا يطابق وقت الخادم';
        else if(Math.abs(Date.parse(o.t)-at)>10*60e3||o.k!==k||o.day!==doc.month+'-'+dd)why='بيانات التسجيل لا تطابق';
        else if(!codeOk)why='رمز المسجد غير صحيح';
        else if((o.p||null)!==(rec.photo||null)&&!rec.phDel)why='صورة الإثبات لا تطابق التسجيل';
        ok=!why;
      }catch(e){why='تعذّر فك التشفير'}
      (patch[dd]=patch[dd]||{})[k]={v:ok,...(why?{vr:why}:{})};n++;
    }
    if(n)await S.db.doc('att/'+doc.id).update({d:patch}).catch(onErr);
  }
}
async function setMosqueCode(mid,code){
  const old=S.codeDocs[mid],now=new Date().toISOString();
  const prev=old&&old.code?[{code:old.code,until:now},...(old.prev||[])].slice(0,12):[];
  await S.db.doc('org/keys/codes/'+mid).set({code,since:now,prev});
  return(await codeHash(mid,code))[0];
}
async function upgradeMosques(){
  if(!S.admin||S.upgraded||!S.loaded.m||!S.codesLoaded)return;S.upgraded=true;
  for(const m of S.mosques){if(m.codeChk||!S.codeDocs[m.id])continue;
    const{id,codeHash:_h,lat:_a,lng:_b,radius:_r,...rest}=m;
    await S.db.doc('org/main/mosques/'+id).set({...rest,codeChk:(await codeHash(id,S.codeDocs[id].code))[0]}).catch(onErr)}
}
function renderAdmin(){
  liveHeader();
  const tabs=[['q360','استعلام 360'],...(window.extAuth?[['accounts','حسابات التطبيق']]:[]),['apps','طلبات التسجيل'],['today','الحضور اليومي'],['monthly','التقارير الشهرية'],['messages','المراسلات'],['leaves','الإجازات'],['month','إحصاء الحضور الشهري'],['lessons','الدروس'],['reports','بلاغات المساجد'],['mosques','المساجد والإعدادات'],['staff','الأئمة والمؤذنون']];
  $('#main').replaceChildren(h('div',{style:'display:grid;gap:16px'},
    h('nav',{class:'tabs'},dyn('adminTabs',()=>tabs.map(([k,l])=>{const n=k==='apps'?S.apps.filter(a=>a.status==='pending').length:k==='monthly'?unreviewedCount():k==='messages'?S.threads.filter(adminUnread).length:k==='leaves'?S.staff.filter(s=>s.uid).reduce((n,s)=>n+leavesOf(s.uid).filter(l=>!l.dec&&!l.cancelled).length,0):0;
      return h('button',{class:'gtab'+(n?' has-badge':''),'aria-pressed':String(S.adminTab===k),onclick:e=>{gRipple(e);S.adminTab=k;renderAdmin()}},gIcon(k),h('span',{class:'gtab-l'},l),n?h('span',{class:'gbadge'},n):null)}))),
    {q360:adminQ360,accounts:adminAccounts,apps:adminApps,leaves:adminLeaves,messages:adminMessages,monthly:adminMonthly,today:adminToday,month:adminMonth,lessons:adminLessons,reports:adminReports,mosques:adminMosques,staff:adminStaff}[S.adminTab]()));
}
function openThread(uid){S.openThread=uid;S.thrIn={};S.thrOut={};
  msgMonths().forEach((mk,i)=>{
    sub('thrIn'+i,()=>S.db.doc('threads/'+uid+'/m/'+mk).onSnapshot(s=>{if(S.openThread===uid){S.thrIn[mk]=s.exists?s.data():null;refresh()}},onErr));
    sub('thrOut'+i,()=>S.db.doc('outbox/'+uid+'/m/'+mk).onSnapshot(s=>{if(S.openThread===uid){S.thrOut[mk]=s.exists?s.data():null;refresh()}},onErr))});
  refresh()}
function adminMessages(){
  return h('div',{style:'display:grid;gap:16px'},h('div',{class:'row spread'},h('h2',null,'المراسلات مع الأئمة'),h('span',{class:'muted small'},'كل محادثة خاصة بين الإدارة وإمام واحد')),dyn('msgBody',()=>{
    const people=S.staff.filter(s=>s.uid);
    if(!people.length)return h('div',{class:'empty'},'لا يوجد أئمة بحسابات مفعّلة بعد. بعد الموافقة على طلبات التسجيل يستطيع كل إمام مراسلة الإدارة من واجهته.');
    const threads=[...S.threads].sort((a,b)=>(b.lastAt||'').localeCompare(a.lastAt||''));
    const noThread=people.filter(s=>!S.threads.some(t=>t.id===s.uid));
    const who=uid=>S.staff.find(x=>x.uid===uid);
    const startSel=h('select',{id:'newThread',style:'width:auto;flex:1'},h('option',{value:''},'— بدء محادثة مع إمام —'),noThread.map(s=>h('option',{value:s.uid},s.name)));
    const side=h('div',{class:'panel',style:'align-content:start'},
      threads.length?h('div',{class:'list'},threads.map(t=>{const s=who(t.id),un=adminUnread(t);
        return h('button',{class:'item',style:'text-align:right;font:inherit;color:inherit;cursor:pointer;'+(S.openThread===t.id?'border-color:var(--olive);background:var(--olive-soft)':''),onclick:()=>openThread(t.id)},
          h('div',{class:'row spread'},h('b',null,s?s.name:'إمام'),un?h('span',{class:'dot','aria-label':'غير مقروءة'}):h('span',{class:'small muted'},t.lastAt?new Date(t.lastAt).toLocaleDateString('ar-PS',{day:'numeric',month:'short'}):'')),
          h('p',{class:'small muted',style:'white-space:nowrap;overflow:hidden;text-overflow:ellipsis'},(t.lastFrom==='admin'?'أنت: ':'')+(t.lastText||'')))})):h('p',{class:'muted small',style:'margin:0'},'لا توجد محادثات بعد.'),
      noThread.length?h('div',{class:'row'},startSel,h('button',{class:'btn ghost sm',onclick:()=>{if(startSel.value)openThread(startSel.value)}},'فتح')):null);
    let main;
    if(!S.openThread)main=h('div',{class:'empty'},'اختر محادثة من القائمة لعرضها والرد عليها.');
    else{const s=who(S.openThread),t=S.threads.find(x=>x.id===S.openThread);
      if(t&&adminUnread(t))markSeen(S.openThread,'adminSeenAt',t);
      const ap=S.apps.find(a=>a.id===S.openThread);
      main=h('div',{class:'panel'},h('div',{class:'row spread'},h('div',null,h('h3',null,s?s.name:'إمام'),h('span',{class:'muted small'},(mosque(s&&s.mosqueId)?.name||'')+(s&&s.role?' · '+s.role:''))),ap&&ap.phone?waLink(ap.phone):null),
        chatBox(mergedMsgs(S.thrIn,S.thrOut),'admin','t-'+S.openThread,(text,photo)=>sendMsg(S.openThread,s?s.id:'','admin',text,photo,S.threads.some(x=>x.id===S.openThread))));}
    return h('div',{style:'display:grid;gap:16px'},h('div',{class:'msgs-grid'},side,main),broadcastBox(people));
  }));
}
function broadcastBox(people){
  const ta=h('textarea',{id:'bcast',placeholder:'نص التعميم الذي سيصل إلى كل إمام في محادثته…',oninput:e=>{S.bcast=e.target.value}},S.bcast||'');
  return h('details',{class:'panel',open:S.bcastOpen,ontoggle:e=>{S.bcastOpen=e.target.open}},h('summary',null,h('b',null,'إرسال تعميم إلى جميع الأئمة ('+people.length+')')),ta,
    h('div',{class:'row'},h('button',{class:'btn',disabled:!!S.bcBusy,onclick:async()=>{const text=(S.bcast||'').trim();if(!text||S.bcBusy)return;S.bcBusy=true;let n=0;
      for(const s of people){try{await sendMsg(s.uid,s.id,'admin','تعميم: '+text,null,S.threads.some(t=>t.id===s.uid));n++;S.bcastStatus='أُرسل إلى '+n+' من '+people.length+'…';refresh()}catch(e){}}
      S.bcast='';S.bcastStatus='أُرسل التعميم إلى '+n+' من '+people.length+' إماماً.';S.bcBusy=false;refresh()}},'إرسال التعميم'),h('span',{class:'small muted'},S.bcastStatus)));
}
function unreviewedCount(){let n=0;S.monthly.forEach(d=>Object.entries(d.reports||{}).forEach(([mk,r])=>{const rv=reviewOf(d.id,mk);if(r.status==='sent'&&!(rv&&rv.status==='reviewed'))n++}));return n}
function adminMonthly(){
  if(!S.repMonth)S.repMonth=defMonth();
  const mIn=h('input',{id:'arMonth',type:'month',value:S.repMonth,style:'width:auto',onchange:e=>{if(e.target.value){S.repMonth=e.target.value;refresh()}}});
  return h('div',{style:'display:grid;gap:16px'},
    h('div',{class:'row spread'},h('h2',null,'التقارير الشهرية الواردة من الأئمة'),h('label',{class:'row small muted'},'الشهر',mIn)),
    dyn('mrBody',()=>{
      const people=S.staff.filter(s=>s.uid);
      if(!people.length)return h('div',{class:'empty'},'لا يوجد أئمة بحسابات مفعّلة بعد. وافق على طلبات التسجيل أولاً، فيظهر لكل إمام تبويب "التقرير الشهري".');
      const by={};S.monthly.forEach(d=>by[d.id]=d);
      const rows=people.map(s=>({s,r:by[s.uid]&&by[s.uid].reports&&by[s.uid].reports[S.repMonth]}));
      const isRev=x=>{const rv=reviewOf(x.s.uid,S.repMonth);return!!(rv&&rv.status==='reviewed')};
      const sent=rows.filter(x=>x.r&&x.r.status==='sent').sort((a,b)=>isRev(a)-isRev(b));
      const missing=rows.filter(x=>!x.r||x.r.status!=='sent');
      const rev=sent.filter(isRev).length;
      return h('div',{style:'display:grid;gap:14px'},
        h('div',{class:'kpis'},
          h('div',{class:'kpi'},h('div',{class:'n'},sent.length+' / '+people.length),h('div',{class:'l'},'تقارير وصلت عن '+monthAr(S.repMonth))),
          h('div',{class:'kpi warn'},h('div',{class:'n'},sent.length-rev),h('div',{class:'l'},'بانتظار المراجعة')),
          h('div',{class:'kpi bad'},h('div',{class:'n'},missing.length),h('div',{class:'l'},'لم يُرسل'))),
        sent.length?h('div',{class:'list'},sent.map(x=>monthlyCard(x.s,x.r))):h('div',{class:'empty'},'لم يصل أي تقرير عن هذا الشهر بعد.'),
        missing.length?h('div',{class:'panel'},h('h3',null,'لم يرسلوا التقرير بعد'),h('div',{class:'list'},missing.map(({s,r})=>{const ap=S.apps.find(a=>a.id===s.uid),ph=ap&&ap.phone;
          return h('div',{class:'row spread',style:'border-bottom:1px solid var(--line);padding-block:6px'},h('span',null,h('b',null,s.name),h('span',{class:'muted small'},' · '+(mosque(s.mosqueId)?.name||'')+(r&&r.status==='draft'?' · كتب مسودة ولم يُرسلها':''))),
            ph?h('a',{class:'btn ghost sm',href:'https://wa.me/'+ph.replace(/\D/g,'')+'?text='+encodeURIComponent('السلام عليكم ورحمة الله، نذكّركم بإرسال التقرير الشهري لشهر '+monthAr(S.repMonth)+' عبر نظام متابعة مساجد نابلس. مديرية أوقاف نابلس'),target:'_blank',rel:'noopener'},'تذكير عبر واتساب'):null)}))):null);
    }));
}
function monthlyCard(s,r){
  const rv=reviewOf(s.uid,S.repMonth),reviewed=!!(rv&&rv.status==='reviewed'),nk=s.uid+'|'+S.repMonth;
  if(S.revNote[nk]===undefined)S.revNote[nk]=(rv&&rv.note)||'';
  const note=h('textarea',{id:'rv-'+s.id,placeholder:'ملاحظة للإمام (اختياري)',style:'min-height:50px',oninput:e=>{S.revNote[nk]=e.target.value}},S.revNote[nk]);
  const v=x=>x==null||x===''?'—':x;
  const stat=(l,x)=>h('div',null,h('div',{class:'muted small'},l),h('b',{class:'count'},v(x)));
  const setReview=st=>upsertMerge('outbox/'+s.uid,{reviews:{[S.repMonth]:{status:st,note:String(S.revNote[nk]||'').trim(),at:new Date().toISOString()}}}).catch(onErr);
  return h('div',{class:'item',style:'gap:10px'},
    h('div',{class:'row spread'},h('div',null,h('b',{style:'font-size:1.05rem'},s.name),h('span',{class:'muted small'},' · '+(mosque(r.mosqueId||s.mosqueId)?.name||''))),mrChip(r,rv)),
    h('p',{class:'muted small'},'أُرسل '+(r.sentAt?new Date(r.sentAt).toLocaleString('ar-PS',{dateStyle:'medium',timeStyle:'short'}):'')+(r.updatedAt&&r.sentAt&&r.updatedAt>r.sentAt?' · عُدّل بعد الإرسال':'')),
    h('div',{class:'fgrid',style:'grid-template-columns:repeat(auto-fit,minmax(110px,1fr))'},stat('مصلّو الفجر',r.w&&r.w.fajr),stat('الصلوات اليومية',r.w&&r.w.daily),stat('الجمعة',r.w&&r.w.jumuah),stat('حلقات التحفيظ',r.q&&r.q.circles),stat('طلاب التحفيظ',r.q&&r.q.students),stat('الدروس المسجّلة',r.lessonsCount)),
    MR_FIELDS.filter(([k])=>r[k]).map(([k,l])=>h('div',null,h('div',{class:'muted small'},l),h('p',{style:'white-space:pre-wrap'},r[k]))),
    r.photos&&r.photos.length?h('div',null,h('div',{class:'muted small'},'صور مرفقة ('+r.photos.length+')'),h('div',{class:'photos'},r.photos.map(id=>photoThumb(id)))):null,
    reviewed?h('div',{class:'row spread'},h('span',{class:'small'},rv.note?'ملاحظتك: '+rv.note:'روجع دون ملاحظات.'),h('button',{class:'btn ghost sm',onclick:()=>setReview('open')},'إعادة فتح')):
      h('div',{style:'display:grid;gap:8px'},note,h('div',{class:'row'},h('button',{class:'btn sm',onclick:()=>setReview('reviewed')},'تمت المراجعة'))));
}
function adminApps(){
  return h('div',{style:'display:grid;gap:16px'},h('div',{class:'row spread'},h('h2',null,'طلبات التسجيل'),h('span',{class:'muted small'},'يسجّل الإمام حسابه من الصفحة نفسها، وتظهر طلباته هنا للمراجعة.')),
    dyn('appsBody',()=>{
      const pend=S.apps.filter(a=>a.status==='pending'),done=S.apps.filter(a=>a.status!=='pending');
      return h('div',{style:'display:grid;gap:14px'},
        pend.length?h('div',{class:'list'},pend.map(appCard)):h('div',{class:'empty'},h('b',null,'لا توجد طلبات بانتظار الموافقة'),h('span',{class:'small'},'شارك الصفحة مع الأئمة والمؤذنين بصلاحية "مساهم" (Contributor)، فيظهر لكل منهم نموذج التسجيل عند فتحها.')),
        done.length?h('details',null,h('summary',{class:'small'},'الطلبات المُعالجة ('+done.length+')'),h('div',{class:'list',style:'margin-top:8px'},done.map(appCard))):null);
    }));
}
function appCard(a){
  const dupId=S.apps.filter(x=>x.id!==a.id&&x.idNo&&x.idNo===a.idNo);
  const linked=S.staff.find(s=>s.uid===a.id);
  const sel=S.appSel[a.id]=S.appSel[a.id]||{role:ROLES.includes(a.role)?a.role:ROLES[0],mosque:a.mosqueId||''};
  if(!sel.mosque&&a.mosqueId)sel.mosque=a.mosqueId;
  const roleSel=h('select',{id:'ar-'+a.id,style:'width:auto',onchange:e=>{sel.role=e.target.value}},ROLES.map(r=>h('option',{selected:r===sel.role},r)));
  const mSel=h('select',{id:'am-'+a.id,style:'width:auto',onchange:e=>{sel.mosque=e.target.value}},h('option',{value:''},'— اختر المسجد —'),S.mosques.map(m=>h('option',{value:m.id,selected:m.id===sel.mosque},m.name)));
  const msg=h('div',null,sel.msg||'');
  const reason=h('input',{id:'rr-'+a.id,placeholder:'سبب الرفض (يظهر لصاحب الطلب)',value:S.rejReason[a.id]||'',oninput:e=>{S.rejReason[a.id]=e.target.value}});
  const rejectWrap=h('div',{class:'row'},reason,h('button',{class:'btn danger sm',onclick:async()=>{await S.db.doc('applications/'+a.id).update({status:'rejected',reason:String(S.rejReason[a.id]||'').trim(),decidedAt:new Date().toISOString()}).catch(onErr)}},'تأكيد الرفض'));
  rejectWrap.hidden=!sel.rejOpen;
  async function approve(){
    if(!sel.mosque||!mosque(sel.mosque)){sel.msg=h('p',{class:'msg err'},'اختر المسجد قبل الموافقة، أو أضف المسجد غير المدرج أولاً.');refresh();return}
    if(sel.busy)return;sel.busy=true;
    const sid=linked?linked.id:'s-'+a.id.replace(/[^A-Za-z0-9_\-]/g,'').slice(-12);
    try{
      await S.db.doc('org/main/staff/'+sid).set({name:a.name,role:sel.role,mosqueId:sel.mosque,uid:a.id,duties:(linked&&linked.duties)||P.map(p=>p.k),subName:a.hasSub?a.subName:'',approvedAt:(linked&&linked.approvedAt)||new Date().toISOString()});
      await S.db.doc('applications/'+a.id).update({status:'approved',staffId:sid,mosqueId:sel.mosque,role:sel.role,decidedAt:new Date().toISOString(),reason:''});
      sel.msg='';
    }catch(e){sel.msg=h('p',{class:'msg err'},'تعذّرت الموافقة، حاول مرة أخرى.')}
    sel.busy=false;refresh();
  }
  async function addOther(){
    const id='m-'+uidGen(),chk=await setMosqueCode(id,genCode());
    await S.db.doc('org/main/mosques/'+id).set({name:a.mosqueOther,area:'',codeChk:chk});
    await S.db.doc('applications/'+a.id).update({mosqueId:id});
    sel.mosque=id;
  }
  const stChip=a.status==='approved'?h('span',{class:'chip ok'},'مقبول'):a.status==='rejected'?h('span',{class:'chip absent'},'مرفوض'):h('span',{class:'chip late'},'بانتظار الموافقة');
  return h('div',{class:'item',style:'gap:10px'},
    h('div',{class:'row spread'},h('b',{style:'font-size:1.05rem'},a.name),stChip),
    h('div',{class:'fgrid small'},
      h('div',null,h('div',{class:'muted'},'رقم الهوية'),h('span',{style:'font-variant-numeric:tabular-nums'},a.idNo)),
      h('div',null,h('div',{class:'muted'},'واتساب'),phoneTxt(a.phone),' ',waLink(a.phone)),
      h('div',null,h('div',{class:'muted'},'الصفة المطلوبة'),a.role),
      h('div',null,h('div',{class:'muted'},'المسجد'),mosque(a.mosqueId)?.name||(a.mosqueOther?a.mosqueOther+' (غير مدرج)':'—'))),
    a.hasSub?h('div',{class:'small',style:'background:var(--sunk);padding:8px 10px;border-radius:8px'},h('b',null,'الإمام البديل: '),a.subName,a.subId?' · هوية '+a.subId:'',' · ',phoneTxt(a.subPhone),' ',waLink(a.subPhone)):h('div',{class:'small muted'},'لا يوجد إمام بديل.'),
    a.idNo&&!idChecksumOk(a.idNo)?h('p',{class:'small',style:'margin:0;color:var(--warn)'},'ملاحظة: رقم الهوية لا يطابق خانة التحقق المعتادة. تأكد منه مع الإمام قبل الموافقة.'):null,
    dupId.length?h('p',{class:'msg err'},'تنبيه: رقم الهوية نفسه مستخدم في طلب آخر باسم '+dupId.map(x=>x.name).join('، ')+'.'):null,
    a.status==='rejected'&&a.reason?h('p',{class:'small muted',style:'margin:0'},'سبب الرفض: '+a.reason):null,
    h('p',{class:'muted small',style:'margin:0'},'قُدّم '+(a.submittedAt?new Date(a.submittedAt).toLocaleString('ar-PS',{dateStyle:'medium',timeStyle:'short'}):'')),
    a.status==='approved'?null:h('div',{style:'display:grid;gap:8px'},
      h('div',{class:'row'},h('span',{class:'small muted'},'الصفة'),roleSel,h('span',{class:'small muted'},'المسجد'),mSel,
        !a.mosqueId&&a.mosqueOther?h('button',{class:'btn ghost sm',onclick:()=>addOther().catch(onErr)},'إضافة «'+a.mosqueOther+'» إلى المساجد'):null),
      msg,
      h('div',{class:'row'},h('button',{class:'btn',onclick:approve},'موافقة وتفعيل الحساب'),h('button',{class:'btn ghost',onclick:()=>{sel.rejOpen=!sel.rejOpen;rejectWrap.hidden=!sel.rejOpen}},'رفض الطلب')),rejectWrap),
    a.status==='approved'?h('div',{class:'row'},h('span',{class:'small muted'},linked?'مرتبط بـ '+(mosque(linked.mosqueId)?.name||'—'):'أُلغي ربط الموظف'),
      confirmBtn('إعادة الطلب للمراجعة',async()=>{if(linked)await S.db.doc('org/main/staff/'+linked.id).delete();await S.db.doc('applications/'+a.id).update({status:'pending'})})):null);
}
function emptyOrg(){
  return h('div',{class:'empty'},h('h2',null,'ابدأ بإضافة المساجد'),
    h('p',null,'أضف مساجد المديرية من تبويب "المساجد"، ثم شارك الصفحة مع الأئمة ليسجّلوا حساباتهم، ووافق عليها من "طلبات التسجيل". يحصل كل مسجد على رمز حضور يُعلَّق داخله.'),
    h('div',{class:'row'},h('button',{class:'btn',onclick:()=>{S.adminTab='mosques';renderAdmin()}},'إضافة مسجد'),h('button',{class:'btn ghost',onclick:seedSamples},'تحميل أمثلة للتجربة')));
}
function adminToday(){
  const dateIn=h('input',{id:'dayPick',type:'date',value:S.dayKey,style:'width:auto',onchange:e=>{if(e.target.value){S.dayKey=e.target.value;watchDay();refresh()}}});
  return h('div',{style:'display:grid;gap:16px'},
    h('div',{class:'row spread'},h('h2',null,'الحضور اليومي'),h('label',{class:'row small muted'},'اليوم',dateIn)),
    dyn('todayBody',()=>{
      if(!S.loaded.m)return h('div',{class:'loading'},'جارٍ التحميل…');
      if(!S.mosques.length)return emptyOrg();
      const day=fromKey(S.dayKey),t=prayerTimes(day);
      let ok=0,late=0,abs=0,pend=0;
      const rows=[];
      S.mosques.forEach(m=>{const st=S.staff.filter(s=>s.mosqueId===m.id);if(!st.length)return;
        rows.push(h('tr',{class:'grp'},h('td',{colspan:'7'},m.name+(m.area?' · '+m.area:''))));
        st.forEach(s=>{const a=S.dayAtt[s.id]?.p||{};
          rows.push(h('tr',null,h('td',null,s.name),h('td',{class:'muted'},s.role||''),P.map(p=>{const r=a[p.k],x=statusOf(r,p.k,s,S.dayKey);if(x==='ok')ok++;else if(x==='late')late++;else if(x==='absent'||x==='bad')abs++;else if(x==='pending')pend++;
            const c=chip(x,r?(r.sub?'بديل ':'')+fmtT(new Date(r.at)):'');
            if(r&&r.pv===false)c.title='صورة الإثبات مرفوضة';else if(r&&r.vr)c.title=r.vr;else if(r&&r.v===undefined&&(r.enc||r.nv))c.title=r.nv?'سُجّل قبل تفعيل التحقق':'بانتظار التحقق من الرمز';
            return h('td',null,c,r&&r.v===undefined&&r.nv?h('span',{class:'small muted'},' ؟'):null,
              r&&r.photo?h('button',{class:'btn ghost sm',style:'margin-inline-start:4px;padding:2px 8px',type:'button',title:'عرض صورة الإثبات',onclick:()=>lightbox(r.photo)},'صورة'):null,
              r&&r.noPhoto?h('span',{class:'small',style:'color:var(--warn)',title:'طُلبت صورة ولم تُرفع'},' دون صورة'):null)})))})});
      const unassigned=S.staff.filter(s=>!mosque(s.mosqueId)).length;
      return h('div',{style:'display:grid;gap:14px'},
        h('div',{class:'kpis'},
          h('div',{class:'kpi'},h('div',{class:'n'},ok),h('div',{class:'l'},'تسجيل في الوقت')),
          h('div',{class:'kpi warn'},h('div',{class:'n'},late),h('div',{class:'l'},'تسجيل متأخر')),
          h('div',{class:'kpi bad'},h('div',{class:'n'},abs),h('div',{class:'l'},'غياب')),
          h('div',{class:'kpi'},h('div',{class:'n'},pend),h('div',{class:'l'},'صلوات لم يحن وقتها'))),
        h('p',{class:'muted small',style:'margin:0'},fmtD(day)+' · '+P.map(p=>pName(p.k,day)+' '+fmtT(t[p.k])).join(' · ')),
        rows.length?h('div',{class:'tbl'},h('table',null,h('thead',null,h('tr',null,h('th',null,'الاسم'),h('th',null,'الصفة'),P.map(p=>h('th',null,pName(p.k,day))))),h('tbody',null,rows)))
          :h('div',{class:'empty'},'لا يوجد أئمة أو مؤذنون مرتبطون بمساجد بعد.',h('button',{class:'btn',onclick:()=>{S.adminTab='staff';renderAdmin()}},'إضافة موظف')),
        unassigned?h('p',{class:'msg err'},unassigned+' موظف دون مسجد صالح، راجع تبويب الأئمة والمؤذنين.'):null,
        h('p',{class:'muted small',style:'margin:0'},'يُتحقق من رمز المسجد لكل تسجيل تلقائياً عند فتح هذه اللوحة. التسجيل «المرفوض» (رمز خاطئ أو صورة مرفوضة) يُحسب غياباً؛ مرّر المؤشر فوقه لمعرفة السبب.'),
        photoReview());
    }));
}
function photoReview(){
  const dd=S.dayKey.slice(8),items=[];
  S.dayDocs.forEach(doc=>Object.entries((doc.d&&doc.d[dd])||{}).forEach(([k,r])=>{if(r&&(r.photo||r.noPhoto))items.push({doc,k,r,s:staffBy(doc.staffId)})}));
  if(!items.length)return null;
  items.sort((a,b)=>(a.r.pv===undefined?0:1)-(b.r.pv===undefined?0:1)||(a.r.at||'').localeCompare(b.r.at||''));
  const pending=items.filter(x=>x.r.photo&&x.r.pv===undefined).length;
  const setPv=(x,v)=>S.db.doc('att/'+x.doc.id).update({d:{[dd]:{[x.k]:{pv:v,pvAt:new Date().toISOString()}}}}).catch(onErr);
  return h('div',{class:'panel'},
    h('div',{class:'row spread'},h('h3',null,'صور الإثبات لهذا اليوم ('+items.length+')'),pending?h('span',{class:'chip late'},pending+' بانتظار المراجعة'):h('span',{class:'chip ok'},'روجعت كلها')),
    h('p',{class:'muted small',style:'margin:0'},'قارن الصورة باللقطة المطلوبة وبالمسجد. الصورة المرفوضة تُحسب غياباً. الصور تُحذف تلقائياً بعد '+photoCfg().keep+' أيام لتوفير المساحة.'),
    h('div',{style:'display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,190px),1fr));gap:10px'},items.map(x=>{
      const r=x.r;
      return h('div',{class:'item',style:'gap:6px;padding:8px'},
        r.photo?h('div',{class:'ph',style:'aspect-ratio:4/3'},h('img',{src:BLOB+r.photo,alt:'صورة إثبات',loading:'lazy',onclick:()=>lightbox(r.photo),onerror:e=>{e.target.replaceWith(h('span',{class:'small muted',style:'display:grid;place-items:center;height:100%'},'حُذفت الصورة'))}}))
          :h('div',{class:'ph',style:'aspect-ratio:4/3;display:grid;place-items:center'},h('span',{class:'small',style:'color:var(--warn)'},r.phDel?'حُذفت الصورة':'لم تُرفع صورة')),
        h('b',{class:'small'},(x.s?x.s.name:'')),
        h('span',{class:'small muted'},pName(x.k,fromKey(S.dayKey))+' · '+fmtT(new Date(r.at))+(r.photoAsk?' · المطلوب: '+r.photoAsk:'')),
        r.photo?(r.pv===undefined?h('div',{class:'row',style:'gap:6px'},h('button',{class:'btn sm',type:'button',onclick:()=>setPv(x,true)},'مقبولة'),h('button',{class:'btn ghost sm',type:'button',style:'color:var(--bad)',onclick:()=>setPv(x,false)},'مرفوضة'))
          :h('div',{class:'row spread'},h('span',{class:'chip '+(r.pv?'ok':'absent')},r.pv?'مقبولة':'مرفوضة'),h('button',{class:'btn ghost sm',type:'button',onclick:()=>S.db.doc('att/'+x.doc.id).update({d:{[dd]:{[x.k]:{pv:!r.pv}}}}).catch(onErr)},'تغيير'))):null);
    })));
}
async function cleanupPhotos(){
  if(!S.admin||!S.assets||S.cleaned)return;S.cleaned=true;
  const keep=photoCfg().keep,cut=Date.now()-keep*864e5,cur=dkey(new Date()).slice(0,7);
  for(const mk of[cur,prevMonthKey(cur),prevMonthKey(prevMonthKey(cur))]){
    let docs=[];try{docs=(await S.db.collection('att').where('month','==',mk).get()).docs.map(d=>({id:d.id,...d.data()}))}catch(e){continue}
    for(const doc of docs){const patch={};let n=0;
      for(const[dd,day]of Object.entries(doc.d||{}))for(const[k,r]of Object.entries(day||{})){
        if(!r||!r.photo||Date.parse(r.at)>cut)continue;
        try{await S.assets.delete(r.photo)}catch(e){if(!e||e.code!=='not_uploader')continue}
        (patch[dd]=patch[dd]||{})[k]={photo:null,phDel:true};n++}
      if(n)await S.db.doc('att/'+doc.id).update({d:patch}).catch(onErr)}}
}
function photoPanel(){
  const c=photoCfg(),o={...c},msg=h('span',{class:'small muted'});
  const active=S.staff.filter(s=>s.uid).length,est=h('p',{class:'small',style:'margin:0'});
  const calc=()=>{const perDay=active*5*(o.mode==='always'?1:o.mode==='random'?o.pct/100:0),files=Math.round(perDay*o.keep),mb=Math.round(files*0.12);
    est.textContent=o.mode==='off'?'صورة الإثبات متوقفة.':'تقديرياً: '+Math.round(perDay)+' صورة يومياً، ونحو '+files+' صورة محفوظة في أي وقت (≈'+mb+' ميغابايت). الحد الأقصى 5000 صورة و1 غيغابايت.';
    est.style.color=files>4000||mb>900?'var(--bad)':''};
  const pct=h('input',{id:'phPct',type:'number',min:'5',max:'100',step:'5',value:o.pct,style:'width:6em',oninput:e=>{o.pct=Math.max(5,Math.min(100,+e.target.value||20));calc()}});
  const keep=h('input',{id:'phKeep',type:'number',min:'1',max:'60',value:o.keep,style:'width:6em',oninput:e=>{o.keep=Math.max(1,Math.min(60,+e.target.value||7));calc()}});
  const pctWrap=h('label',{class:'f'},'نسبة الصلوات التي تُطلب فيها صورة (%)',pct);pctWrap.hidden=o.mode!=='random';
  const mode=h('select',{id:'phMode',onchange:e=>{o.mode=e.target.value;pctWrap.hidden=o.mode!=='random';calc()}},
    [['random','عشوائية: في نسبة من الصلوات'],['always','إلزامية في كل صلاة'],['off','متوقفة']].map(([v,l])=>h('option',{value:v,selected:v===o.mode},l)));
  calc();
  return h('div',{class:'panel'},h('h3',null,'صورة الإثبات عند الحضور'),
    h('p',{class:'muted small',style:'margin:0'},'يلتقط الإمام صورة فورية من كاميرا الهاتف للقطة يحددها النظام عشوائياً (المحراب، المنبر، ساعة المسجد…). يُختم على الصورة اسمه والمسجد والصلاة والوقت، وتُرفض الصور القديمة من المعرض.'),
    h('label',{class:'f'},'طريقة الطلب',mode),pctWrap,h('label',{class:'f'},'مدة الاحتفاظ بالصور (أيام)',keep),est,
    h('div',{class:'row'},h('button',{class:'btn sm',onclick:async()=>{try{await saveSettings({photo:{mode:o.mode,pct:o.pct,keep:o.keep}});msg.textContent='حُفظت الإعدادات.'}catch(e){msg.textContent='تعذّر الحفظ.'}}},'حفظ الإعدادات'),msg));
}
function computeMonth(month){
  const[y,mo]=month.split('-').map(Number),last=new Date(y,mo,0).getDate(),todayK=dkey(new Date());
  const days=[];for(let d=1;d<=last;d++){const k=y+'-'+pad(mo)+'-'+pad(d);if(k>todayK)break;days.push(k)}
  const by={},lessonsBy={};S.monthDocs.forEach(doc=>{const o=by[doc.staffId]=by[doc.staffId]||{};Object.entries(doc.d||{}).forEach(([dd,p])=>{o[doc.month+'-'+dd]=p||{}});lessonsBy[doc.staffId]=(lessonsBy[doc.staffId]||0)+Object.keys(doc.l||{}).length});
  const rows=S.staff.filter(s=>s.uid).map(s=>{let exp=0,on=0,late=0,bad=0,leave=0;
    days.forEach(k=>P.forEach(p=>{const st=statusOf(by[s.id]?.[k]?.[p.k],p.k,s,k);if(st==='leave'){leave++;return}if(st==='na'||st==='pending')return;exp++;if(st==='ok')on++;else if(st==='late')late++;else if(st==='bad')bad++}));
    const rate=exp?Math.round((on+late)/exp*100):null;
    return{s,exp,on,late,bad,abs:exp-on-late-bad,leave,rate,les:lessonsBy[s.id]||0}}).sort((a,b)=>(a.rate??101)-(b.rate??101));
  return{days,by,rows};
}
function adminMonth(){
  const mIn=h('input',{id:'monthPick',type:'month',value:S.month,style:'width:auto',onchange:e=>{if(e.target.value){S.month=e.target.value;watchMonth();refresh()}}});
  return h('div',{style:'display:grid;gap:16px'},
    h('div',{class:'row spread'},h('h2',null,'إحصاء الحضور الشهري'),h('div',{class:'row'},h('label',{class:'row small muted'},'الشهر',mIn),dyn('xlsBtn',exportButton))),
    dyn('monthBody',()=>{
      if(!S.staff.length)return emptyOrg();
      const{days,rows}=computeMonth(S.month);
      return h('div',{style:'display:grid;gap:12px'},
        h('p',{class:'muted small',style:'margin:0'},'محسوب على '+days.length+' يوماً حتى اليوم. الإجازات المعتمدة لا تُحسب ضمن المطلوب. الترتيب من الأقل التزاماً.'),
        h('div',{class:'tbl'},h('table',null,h('thead',null,h('tr',null,['الاسم','الصفة','المسجد','المطلوب','في الوقت','متأخر','غياب','مرفوض','إجازة','نسبة الالتزام','الدروس'].map(x=>h('th',null,x)))),
          h('tbody',null,rows.map(r=>h('tr',null,h('td',null,r.s.name),h('td',{class:'muted'},r.s.role||''),h('td',null,mosque(r.s.mosqueId)?.name||'—'),
            h('td',{class:'num'},r.exp),h('td',{class:'num'},r.on),h('td',{class:'num'},r.late),h('td',{class:'num'},r.abs),h('td',{class:'num'},r.bad),h('td',{class:'num'},r.leave),
            h('td',null,r.rate==null?h('span',{class:'muted small'},'لا صلوات بعد'):h('span',{class:'chip '+(r.rate>=90?'ok':r.rate>=70?'late':'absent')},r.rate+'%')),h('td',{class:'num'},r.les)))))));
    }));
}
function exportButton(){
  return h('span',{class:'row',style:'gap:8px'},h('button',{class:'btn',type:'button',disabled:!!S.xlsBusy,onclick:exportMonthXlsx},S.xlsBusy?'جارٍ التجهيز…':'تصدير إلى Excel'),S.xlsMsg?h('span',{class:'small',style:'color:'+(S.xlsOk?'var(--ok)':'var(--bad)')},S.xlsMsg):null);
}
function loadXLSX(){if(window.XLSX)return Promise.resolve(window.XLSX);return new Promise((res,rej)=>{const s=document.createElement('script');s.src='https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';s.onload=()=>window.XLSX?res(window.XLSX):rej(new Error('xlsx'));s.onerror=()=>rej(new Error('xlsx'));document.head.append(s)})}
const cellText=(r,st)=>{const t=ST[st]||'';if(!r)return t;let x=t+' '+fmtT(new Date(r.at));if(st==='late')x+=' ('+r.min+' د)';if(r.sub)x+=' · البديل';if(r.photo)x+=' · صورة';if(r.vr)x+=' · '+r.vr;if(r.pv===false)x+=' · صورة مرفوضة';return x};
async function exportMonthXlsx(){
  if(S.xlsBusy)return;S.xlsBusy=true;S.xlsMsg='';refresh();
  try{
    const dl=await window.claude.use('downloads');
    if(!dl)throw{local:'تنزيل الملفات غير متاح في هذا العرض. افتح البوابة في المتصفح أو تطبيق Claude.'};
    const X=await loadXLSX().catch(()=>{throw{local:'تعذّر تحميل أداة Excel. تحقق من الاتصال وحاول مرة أخرى.'}});
    const month=S.month,{days,by,rows}=computeMonth(month),title='كشف الحضور الشهري — مديرية أوقاف نابلس — '+monthAr(month);
    const gen='أُعدّ في '+new Date().toLocaleString('ar-PS',{dateStyle:'medium',timeStyle:'short'})+' · محسوب على '+days.length+' يوماً';
    const wb=X.utils.book_new();
    const sum=[[title],[gen],[],['#','الاسم','الصفة','المسجد','الصلوات المطلوبة','في الوقت','متأخر','غياب','مرفوض','إجازة','نسبة الالتزام %','الدروس']];
    [...rows].sort((a,b)=>(mosque(a.s.mosqueId)?.name||'').localeCompare(mosque(b.s.mosqueId)?.name||'','ar')||a.s.name.localeCompare(b.s.name,'ar'))
      .forEach((r,i)=>sum.push([i+1,r.s.name,r.s.role||'',mosque(r.s.mosqueId)?.name||'',r.exp,r.on,r.late,r.abs,r.bad,r.leave,r.rate==null?'—':r.rate,r.les]));
    const tot=rows.reduce((a,r)=>{['exp','on','late','abs','bad','leave','les'].forEach(k=>a[k]+=r[k]);return a},{exp:0,on:0,late:0,abs:0,bad:0,leave:0,les:0});
    sum.push([],['','المجموع','','',tot.exp,tot.on,tot.late,tot.abs,tot.bad,tot.leave,tot.exp?Math.round((tot.on+tot.late)/tot.exp*100):0,tot.les]);
    const ws1=X.utils.aoa_to_sheet(sum);ws1['!cols']=[4,30,14,24,10,10,8,8,8,8,12,8].map(w=>({wch:w}));ws1['!merges']=[{s:{r:0,c:0},e:{r:0,c:11}},{s:{r:1,c:0},e:{r:1,c:11}}];
    X.utils.book_append_sheet(wb,ws1,'الملخص');
    const det=[[title],[],['التاريخ','اليوم','الاسم','المسجد',...P.map(p=>p.n)]];
    rows.map(r=>r.s).sort((a,b)=>a.name.localeCompare(b.name,'ar')).forEach(s=>days.forEach(k=>{
      const day=(by[s.id]&&by[s.id][k])||{},sts=P.map(p=>statusOf(day[p.k],p.k,s,k));
      if(sts.every(x=>x==='na'))return;
      det.push([k,fromKey(k).toLocaleDateString('ar-PS',{weekday:'long'}),s.name,mosque(s.mosqueId)?.name||'',...P.map((p,i)=>cellText(day[p.k],sts[i]))])}));
    const ws2=X.utils.aoa_to_sheet(det);ws2['!cols']=[12,10,30,22,26,26,26,26,26].map(w=>({wch:w}));
    X.utils.book_append_sheet(wb,ws2,'التفصيل اليومي');
    const lv=[[title+' — الإجازات المعتمدة'],[],['الاسم','المسجد','نوع الإجازة','من','إلى','الأيام في الشهر','الصلوات','الإمام البديل','هاتف البديل','ملاحظة الإدارة']];
    const m0=month+'-01',m1=month+'-31';
    S.staff.filter(s=>s.uid).forEach(s=>leavesOf(s.uid).forEach(l=>{if(l.cancelled||!l.dec||l.dec.status!=='approved'||l.to<m0||l.from>m1)return;
      const a=l.from<m0?m0:l.from,b=l.to>m1?dkey(new Date(+month.slice(0,4),+month.slice(5),0)):l.to;
      lv.push([s.name,mosque(s.mosqueId)?.name||'',l.type,l.from,l.to,daysBetween(a,b),l.prayers==='all'||!l.prayers?'كل الصلوات':l.prayers.map(k=>P.find(p=>p.k===k)?.n).join('، '),l.subName||'',l.subPhone||'',l.dec.note||''])}));
    if(lv.length===3)lv.push(['لا توجد إجازات معتمدة في هذا الشهر.']);
    const ws3=X.utils.aoa_to_sheet(lv);ws3['!cols']=[30,22,16,12,12,12,20,26,16,30].map(w=>({wch:w}));
    X.utils.book_append_sheet(wb,ws3,'الإجازات');
    wb.Workbook={Views:[{RTL:true}]};
    const buf=X.write(wb,{type:'array',bookType:'xlsx'});
    await dl.save({filename:'كشف-الحضور-'+month+'.xlsx',data:new Blob([buf])});
    S.xlsOk=true;S.xlsMsg='تم تجهيز الملف.';
  }catch(e){S.xlsOk=false;S.xlsMsg=e&&e.local?e.local:e&&e.code==='declined'?'أُلغي التنزيل.':e&&e.code==='rate_limited'?'هناك نافذة تنزيل مفتوحة، انتظر قليلاً.':'تعذّر تجهيز الملف.'}
  S.xlsBusy=false;refresh();
}
function adminLessons(){
  const mIn=h('input',{id:'lesMonth',type:'month',value:S.month,style:'width:auto',onchange:e=>{if(e.target.value){S.month=e.target.value;watchMonth();refresh()}}});
  return h('div',{style:'display:grid;gap:16px'},h('div',{class:'row spread'},h('h2',null,'الدروس والأنشطة'),h('label',{class:'row small muted'},'الشهر',mIn)),dyn('lesBody',()=>{
    const L=lessonsOf(S.monthDocs);
    if(!L.length)return h('div',{class:'empty'},'لا توجد دروس مسجّلة في '+monthAr(S.month)+'. يسجّل الإمام دروسه من واجهته في تبويب "الدروس".');
    const per={};L.forEach(l=>per[l.mosqueId]=(per[l.mosqueId]||0)+1);
    return h('div',{class:'grid2'},
      h('div',{class:'list'},L.slice(0,150).map(lessonItem)),
      h('div',{class:'panel'},h('h3',null,'عدد الدروس لكل مسجد'),h('div',{class:'tbl'},h('table',null,h('tbody',null,S.mosques.map(m=>h('tr',null,h('td',null,m.name),h('td',{class:'num'},per[m.id]||0))))))));
  }));
}
function adminReports(){
  const filt={v:'open'};
  return h('div',{style:'display:grid;gap:16px'},h('h2',null,'بلاغات المساجد'),dyn('repBody',()=>{
    if(!S.reports.length)return h('div',{class:'empty'},'لا توجد بلاغات. يرسل الإمام أو المؤذن البلاغ من تبويب "بلاغ عن المسجد".');
    const open=S.reports.filter(r=>repStatus(r)!=='done'),done=S.reports.filter(r=>repStatus(r)==='done');
    const urgent=open.filter(r=>r.severity==='high').length;
    return h('div',{style:'display:grid;gap:14px'},
      h('div',{class:'kpis'},h('div',{class:'kpi bad'},h('div',{class:'n'},urgent),h('div',{class:'l'},'عاجل مفتوح')),h('div',{class:'kpi warn'},h('div',{class:'n'},open.length),h('div',{class:'l'},'مفتوح')),h('div',{class:'kpi'},h('div',{class:'n'},done.length),h('div',{class:'l'},'مُغلق'))),
      h('h3',null,'المفتوحة'),open.length?h('div',{class:'list'},open.sort((a,b)=>(b.severity==='high')-(a.severity==='high')).map(r=>reportItem(r,true))):h('p',{class:'muted small'},'لا شيء مفتوح.'),
      done.length?h('details',null,h('summary',{class:'small'},'المغلقة ('+done.length+')'),h('div',{class:'list',style:'margin-top:8px'},done.slice(0,40).map(r=>reportItem(r,true)))):null);
  }));
}
function genCode(){return String(Math.floor(100000+Math.random()*900000))}
function adminMosques(){
  const e=S.editMosque||{};
  const f={name:h('input',{id:'mName',value:e.name||'',placeholder:'مثال: جامع النصر'}),area:h('input',{id:'mArea',value:e.area||'',placeholder:'الحي أو البلدة'})};
  const msg=h('div');
  return h('div',{class:'grid2'},
    h('div',{style:'display:grid;gap:18px'},
    h('div',{class:'panel'},h('h2',null,e.id?'تعديل مسجد':'إضافة مسجد'),
      h('label',{class:'f'},'اسم المسجد',f.name),h('label',{class:'f'},'الموقع',f.area),
      h('p',{class:'muted small',style:'margin:0'},'يحصل كل مسجد على رمز حضور من 6 أرقام يُعلَّق داخله. غيّر الرمز دورياً من زر «رمز جديد».'),msg,
      h('div',{class:'row'},h('button',{class:'btn',onclick:async()=>{
        if(!f.name.value.trim()){msg.replaceChildren(h('p',{class:'msg err'},'اكتب اسم المسجد.'));return}
        const id=e.id||'m-'+uidGen();
        const doc={name:f.name.value.trim(),area:f.area.value.trim(),sample:!!e.sample,codeChk:e.codeChk||''};
        try{if(!e.id)doc.codeChk=await setMosqueCode(id,genCode());
          await S.db.doc('org/main/mosques/'+id).set(doc);S.editMosque=null;renderAdmin()}catch(err){msg.replaceChildren(h('p',{class:'msg err'},'تعذّر الحفظ.'))}}},e.id?'حفظ التعديل':'إضافة المسجد'),
        e.id?h('button',{class:'btn ghost',onclick:()=>{S.editMosque=null;renderAdmin()}},'إلغاء'):null)),
    photoPanel(),timesPanel()),
    h('div',{style:'display:grid;gap:10px'},h('h3',null,'مساجد المديرية'),dyn('mList',()=>{
      if(!S.mosques.length)return h('div',{class:'empty'},'لا توجد مساجد بعد.',h('button',{class:'btn ghost',onclick:seedSamples},'تحميل أمثلة للتجربة'));
      const hasSample=S.mosques.some(m=>m.sample)||S.staff.some(s=>s.sample);
      return h('div',{class:'list'},S.mosques.map(m=>{const n=S.staff.filter(s=>s.mosqueId===m.id).length;return h('div',{class:'item'},
        h('div',{class:'row spread'},h('b',null,m.name+(m.sample?' (مثال)':'')),h('span',null,'الرمز ',h('span',{class:'code'},S.codes[m.id]||'—'))),
        h('p',{class:'muted small'},[m.area,n+' موظف',S.codeDocs[m.id]&&S.codeDocs[m.id].since?'الرمز منذ '+new Date(S.codeDocs[m.id].since).toLocaleDateString('ar-PS',{day:'numeric',month:'short'}):''].filter(Boolean).join(' · ')),
        h('div',{class:'row'},h('button',{class:'btn ghost sm',onclick:()=>{S.editMosque=m;renderAdmin()}},'تعديل'),
          h('button',{class:'btn ghost sm',onclick:async()=>{const chk=await setMosqueCode(m.id,genCode());await S.db.doc('org/main/mosques/'+m.id).update({codeChk:chk})}},'رمز جديد'),
          confirmBtn('حذف',()=>Promise.all([S.db.doc('org/main/mosques/'+m.id).delete(),S.db.doc('org/keys/codes/'+m.id).delete()]))))}),
        hasSample?h('button',{class:'btn ghost sm',onclick:clearSamples},'حذف كل بيانات الأمثلة'):null)})));
}
function timesPanel(){
  const o={...((S.settings&&S.settings.offsets)||{})},msg=h('span',{class:'small muted'});
  const today=new Date(),raw=rawPrayerTimes(today);
  const cells=P.map(p=>{const out=h('b',{class:'count'});const inp=h('input',{id:'off-'+p.k,type:'number',min:'-30',max:'30',step:'1',inputmode:'numeric',value:o[p.k]||0,style:'width:5.5em',
      oninput:e=>{o[p.k]=Math.max(-30,Math.min(30,Math.round(+e.target.value||0)));out.textContent=fmtT(new Date(raw[p.k].getTime()+o[p.k]*60000))}});
    out.textContent=fmtT(new Date(raw[p.k].getTime()+(+o[p.k]||0)*60000));
    return h('label',{class:'f'},p.n,h('div',{class:'row',style:'gap:6px'},inp,out))});
  return h('div',{class:'panel'},h('h3',null,'ضبط مواقيت الصلاة'),
    h('p',{class:'muted small',style:'margin:0'},'المواقيت محسوبة فلكياً لمدينة نابلس. أضف أو اطرح دقائق لكل صلاة لتطابق تقويم وزارة الأوقاف المعتمد. التعديل يسري على جميع الأئمة فوراً.'),
    h('div',{class:'fgrid'},cells),
    h('div',{class:'row'},h('button',{class:'btn sm',onclick:async()=>{try{await saveSettings({offsets:o});msg.textContent='حُفظت المواقيت.'}catch(e){msg.textContent='تعذّر الحفظ.'}}},'حفظ المواقيت'),msg));
}
function confirmBtn(label,fn){const wrap=h('span',{class:'row'});const b=h('button',{class:'btn ghost sm',onclick:()=>{wrap.replaceChildren(h('span',{class:'small'},'متأكد؟'),h('button',{class:'btn danger sm',onclick:()=>fn().catch(onErr)},'نعم، احذف'),h('button',{class:'btn ghost sm',onclick:()=>wrap.replaceChildren(b)},'تراجع'))}},label);wrap.append(b);return wrap}
function adminStaff(){
  const e=S.editStaff||{};
  const f={name:h('input',{id:'sName',value:e.name||''}),subName:h('input',{id:'sSub',value:e.subName||'',placeholder:'اتركه فارغاً إن لم يوجد'}),role:h('select',{id:'sRole'},ROLES.map(r=>h('option',{selected:r===e.role},r))),
    mosque:h('select',{id:'sMosque'},S.mosques.map(m=>h('option',{value:m.id,selected:m.id===e.mosqueId},m.name))),phone:h('input',{id:'sPhone',value:(e.id&&S.phones[e.id])||e.phone||'',inputmode:'tel',dir:'ltr'})};
  const duties=e.duties||P.map(p=>p.k);
  const boxes=P.map(p=>h('input',{type:'checkbox',id:'d-'+p.k,value:p.k,checked:duties.includes(p.k)}));
  const msg=h('div');
  if(!S.mosques.length)return emptyOrg();
  return h('div',{class:'grid2'},
    h('div',{class:'panel'},h('h2',null,e.id?'تعديل بيانات موظف':'إضافة موظف يدوياً'),
      e.id?null:h('p',{class:'muted small',style:'margin:0'},'الطريقة المعتمدة أن يسجّل الإمام حسابه بنفسه ثم توافق عليه من «طلبات التسجيل». الإضافة اليدوية هنا لمن لا يملك حساباً، ولا يستطيع تسجيل حضوره بنفسه.'),
      h('label',{class:'f'},'الاسم الرباعي',f.name),h('div',{class:'fgrid'},h('label',{class:'f'},'الصفة',f.role),h('label',{class:'f'},'المسجد',f.mosque),h('label',{class:'f'},'الهاتف',f.phone)),
      h('label',{class:'f'},'الإمام البديل',f.subName),
      h('div',{class:'f'},h('span',{class:'small muted'},'الصلوات المكلّف بها'),h('div',{class:'checks'},P.map((p,i)=>h('label',null,boxes[i],p.n)))),msg,
      h('div',{class:'row'},h('button',{class:'btn',onclick:async()=>{
        if(!f.name.value.trim()){msg.replaceChildren(h('p',{class:'msg err'},'اكتب الاسم.'));return}
        const id=e.id||'s-'+uidGen();
        try{const ph=f.phone.value.trim();if(ph||S.phones[id])await S.db.doc('org/keys/phones/'+id).set({phone:ph});
          await S.db.doc('org/main/staff/'+id).set({name:f.name.value.trim(),role:f.role.value,mosqueId:f.mosque.value,subName:f.subName.value.trim(),duties:boxes.filter(b=>b.checked).map(b=>b.value),sample:!!e.sample,uid:e.uid||null,approvedAt:e.approvedAt||null});S.editStaff=null;renderAdmin()}
        catch(err){msg.replaceChildren(h('p',{class:'msg err'},'تعذّر الحفظ.'))}}},e.id?'حفظ التعديل':'إضافة'),
        e.id?h('button',{class:'btn ghost',onclick:()=>{S.editStaff=null;renderAdmin()}},'إلغاء'):null)),
    h('div',{style:'display:grid;gap:10px'},h('h3',null,'الأئمة والمؤذنون'),dyn('sList',()=>S.staff.length?h('div',{class:'list'},S.staff.map(s=>h('div',{class:'item'},
      h('div',{class:'row spread'},h('b',null,s.name+(s.sample?' (مثال)':'')),h('span',{class:'muted small'},s.role)),
      h('p',{class:'muted small'},[mosque(s.mosqueId)?.name||'دون مسجد',(s.duties||[]).length+' صلوات',s.subName?'البديل: '+s.subName:'',s.uid?'حساب مفعّل':'دون حساب'].filter(Boolean).join(' · ')),
      (()=>{const ap=S.apps.find(x=>x.id===s.uid);const ph=ap?ap.phone:(S.phones[s.id]||s.phone);return ap||ph?h('p',{class:'small'},ap?'هوية '+ap.idNo+' · ':'',phoneTxt(ph),' ',waLink(normPhone(ph||''))):null})(),
      s.uid?(()=>{const cr=S.creds.find(c=>c.id===s.uid);return h('p',{class:'small'},cr?['اسم المستخدم: ',h('span',{dir:'ltr',style:'font-weight:600'},cr.username)]:h('span',{class:'muted'},'لم يُنشئ اسم مستخدم وكلمة مرور بعد'))})():null,
      h('div',{class:'row'},h('button',{class:'btn ghost sm',onclick:()=>{S.editStaff=s;renderAdmin()}},'تعديل'),
        s.uid&&S.creds.some(c=>c.id===s.uid)?confirmBtn('إعادة تعيين كلمة المرور',()=>S.db.doc('creds/'+s.uid).delete()):null,
        confirmBtn('حذف',()=>S.db.doc('org/main/staff/'+s.id).delete()))))):h('p',{class:'muted small'},'لم يُضف أحد بعد.'))));
}
async function seedSamples(){
  const M=[['المسجد الصلاحي الكبير','البلدة القديمة',32.2196,35.2617],['جامع النصر','دوار الشهداء',32.2213,35.2610],['مسجد الحنبلي','البلدة القديمة',32.2204,35.2632]];
  const names=[['أحمد (مثال)','إمام وخطيب'],['محمود (مثال)','مؤذن'],['يوسف (مثال)','إمام'],['خالد (مثال)','مؤذن'],['عمر (مثال)','إمام'],['سامر (مثال)','مؤذن']];
  try{for(let i=0;i<M.length;i++){const id='m-ex'+i;
      await S.db.doc('org/main/mosques/'+id).set({name:M[i][0],area:M[i][1],codeChk:await setMosqueCode(id,genCode()),sample:true});
      for(let j=0;j<2;j++){const n=names[i*2+j];await S.db.doc('org/main/staff/s-ex'+(i*2+j)).set({name:n[0],role:n[1],mosqueId:id,duties:P.map(p=>p.k),sample:true})}}}
  catch(e){onErr(e)}
}
async function clearSamples(){for(const s of S.staff.filter(s=>s.sample))await S.db.doc('org/main/staff/'+s.id).delete().catch(onErr);for(const m of S.mosques.filter(m=>m.sample)){await S.db.doc('org/main/mosques/'+m.id).delete().catch(onErr);await S.db.doc('org/keys/codes/'+m.id).delete().catch(onErr)}}


/* ======================= APP ACCOUNTS (username + activation code) ======================= */
S.acc={list:null,busy:false,msg:'',f:{role:'imam'},issued:null,q:''};
const SITE=location.origin;
function actLink(u,c){return SITE+'/a/?u='+encodeURIComponent(u)+'&c='+encodeURIComponent(c)}
function actText(name,u,c){return['السلام عليكم ورحمة الله وبركاته'+(name?' '+name:''),'','مديرية أوقاف نابلس – نظام متابعة المساجد','','اسم المستخدم: '+u,'رمز التفعيل: '+c,'','لتفعيل حسابك افتح الرابط التالي من هاتفك:',actLink(u,c),'','• هواتف أندرويد: نزّل تطبيق الأئمة من الرابط ثم سجّل الدخول.','• هواتف آيفون: افتح بوابة الأئمة من الرابط نفسه.','','بعد أول دخول أنشئ كلمة مرور خاصة بك، ويمكنك تفعيل الدخول بالبصمة من التطبيق.'].join('\n')}
function waUrl(phone,text){const p=String(phone||'').replace(/\D/g,'');return'https://wa.me/'+(p||'')+'?text='+encodeURIComponent(text)}
async function accLoad(){S.acc.busy=true;refresh();try{const r=await extAuth.call('list');S.acc.list=r.users.sort((a,b)=>(b.createdAt||'').localeCompare(a.createdAt||''));S.acc.msg=''}catch(e){S.acc.msg='تعذّر تحميل الحسابات: '+((e&&e.error)||'')}S.acc.busy=false;refresh()}
const ACC_ERR={username_taken:'اسم المستخدم مستخدم من قبل. اختر اسماً آخر.',bad_username:'اسم المستخدم من 3 إلى 30 خانة: حروف إنجليزية صغيرة وأرقام و . _ - فقط.',forbidden:'حسابك لا يملك صلاحية إدارة الحسابات.',self:'لا يمكن تنفيذ هذا على حسابك الحالي.'};
function suggestUser(phone){const d=toLatin(phone||'').replace(/\D/g,'');const loc=d.startsWith('970')||d.startsWith('972')?'0'+d.slice(3):d;return loc.length>=9?loc:''}
function issuedCard(x){
  const text=actText(x.name,x.username,x.code);
  return h('div',{class:'panel',style:'border-color:var(--olive);background:var(--olive-soft)'},
    h('div',{class:'row spread'},h('h3',null,x.title||'بيانات التفعيل'),h('button',{class:'btn ghost sm',onclick:()=>{S.acc.issued=null;refresh()}},'إغلاق')),
    h('div',{class:'tbl'},h('table',null,h('tbody',null,
      h('tr',null,h('th',{style:'width:38%'},'الاسم'),h('td',null,x.name||'—')),
      h('tr',null,h('th',null,'اسم المستخدم'),h('td',{dir:'ltr',style:'font-weight:700'},x.username)),
      h('tr',null,h('th',null,'رمز التفعيل'),h('td',{dir:'ltr',style:'font-weight:800;font-size:1.25rem;letter-spacing:.12em;font-variant-numeric:tabular-nums'},x.code)),
      h('tr',null,h('th',null,'رابط التفعيل'),h('td',{dir:'ltr',style:'white-space:normal;word-break:break-all'},h('a',{href:actLink(x.username,x.code),target:'_blank',rel:'noopener'},actLink(x.username,x.code))))))),
    h('div',{class:'row'},
      h('a',{class:'btn',href:waUrl(x.phone,text),target:'_blank',rel:'noopener',style:'text-decoration:none'},'إرسال رابط التفعيل عبر واتساب'),
      h('button',{class:'btn ghost',onclick:async e=>{try{await navigator.clipboard.writeText(text);e.target.textContent='نُسخت الرسالة'}catch(_){e.target.textContent='تعذّر النسخ'}}},'نسخ الرسالة')),
    h('p',{class:'small muted',style:'margin:0'},'يظهر الرمز هنا مرة واحدة فقط. إن ضاع، أصدر رمزاً جديداً من القائمة.'));
}
function adminAccounts(){
  if(S.acc.list===null&&!S.acc.busy)setTimeout(accLoad,0);
  const F=S.acc.f;
  const inp=(k,attrs)=>h('input',{id:'acc-'+k,value:F[k]||'',...attrs,oninput:e=>{F[k]=e.target.value;if(k==='phone'&&!F.userTouched){F.username=suggestUser(e.target.value);const u=document.getElementById('acc-username');if(u)u.value=F.username}if(k==='username')F.userTouched=true}});
  const msg=h('div',null,S.acc.formMsg||'');
  async function create(){
    const u=String(F.username||'').trim().toLowerCase(),ph=F.phone?normPhone(F.phone):'';
    if(F.phone&&!ph){S.acc.formMsg=h('p',{class:'msg err'},'رقم الواتساب غير صحيح. اكتبه بصيغة 059xxxxxxx.');refresh();return}
    if(!/^[a-z0-9][a-z0-9._-]{2,29}$/.test(u)){S.acc.formMsg=h('p',{class:'msg err'},ACC_ERR.bad_username);refresh();return}
    if(S.acc.creating)return;S.acc.creating=true;S.acc.formMsg=h('p',{class:'msg'},'جارٍ إنشاء الحساب…');refresh();
    try{const r=await extAuth.call('create',{username:u,name:String(F.name||'').trim(),phone:ph||'',role:F.role});
      S.acc.issued={name:String(F.name||'').trim(),username:r.username,code:r.code,phone:ph,title:'أُنشئ الحساب'};S.acc.f={role:F.role};S.acc.formMsg='';accLoad()}
    catch(e){S.acc.formMsg=h('p',{class:'msg err'},ACC_ERR[e&&e.error]||('تعذّر الإنشاء: '+((e&&e.error)||'')))}
    S.acc.creating=false;refresh();
  }
  return h('div',{style:'display:grid;gap:16px'},
    h('div',{class:'row spread'},h('h2',null,'حسابات التطبيق'),h('span',{class:'muted small'},'اسم مستخدم ورمز تفعيل لكل إمام أو آذن، يُرسلان عبر واتساب')),
    dyn('accIssued',()=>S.acc.issued?issuedCard(S.acc.issued):[]),
    h('div',{class:'grid2'},
      h('div',{class:'panel'},h('h3',null,'إنشاء حساب جديد'),
        h('label',{class:'f'},'الاسم',inp('name',{placeholder:'الاسم الرباعي (اختياري)'})),
        h('div',{class:'fgrid'},
          h('label',{class:'f'},'رقم الواتساب',inp('phone',{inputmode:'tel',dir:'ltr',placeholder:'059xxxxxxx'})),
          h('label',{class:'f'},'اسم المستخدم',inp('username',{dir:'ltr',autocapitalize:'none',spellcheck:'false',placeholder:'مثال: 0599123456'})),
          h('label',{class:'f'},'نوع الحساب',h('select',{id:'acc-role',onchange:e=>{F.role=e.target.value}},h('option',{value:'imam',selected:F.role!=='admin'},'إمام / مؤذن / آذن'),h('option',{value:'admin',selected:F.role==='admin'},'موظف إدارة (صلاحية كاملة)')))),
        h('p',{class:'small muted',style:'margin:0'},'يُقترح رقم الهاتف اسماً للمستخدم. بعد الإنشاء يظهر رمز تفعيل من 8 أرقام، ويُطلب من صاحب الحساب إنشاء كلمة مرور خاصة به عند أول دخول. بعدها يعبّئ الإمام طلب التسجيل (الاسم الرباعي والهوية والمسجد) وتوافق عليه من «طلبات التسجيل».'),
        msg,h('button',{class:'btn',disabled:!!S.acc.creating,onclick:create},'إنشاء الحساب وإصدار رمز التفعيل')),
      h('div',{class:'panel'},h('h3',null,'تطبيق الأئمة'),
        h('p',{class:'small',style:'margin:0'},'رابط تنزيل تطبيق أندرويد (APK):'),h('a',{href:APK_URL,dir:'ltr',style:'word-break:break-all',class:'small'},APK_URL),
        h('p',{class:'small',style:'margin:0'},'بوابة الأئمة لأجهزة آيفون:'),h('a',{href:SITE+'/imam/',dir:'ltr',class:'small'},SITE+'/imam/'),
        h('p',{class:'small muted',style:'margin:0'},'رابط التفعيل الذي يصل الإمام يتعرّف على نوع هاتفه تلقائياً: يعرض تنزيل التطبيق لأندرويد، وبوابة الويب لآيفون.'))),
    h('div',{class:'panel'},h('h3',null,'تغيير كلمة مرور حسابي (الإدارة)'),
      h('div',{class:'fgrid'},
        h('label',{class:'f'},'كلمة المرور الجديدة',h('input',{id:'my-pw1',type:'password',dir:'ltr',autocomplete:'new-password'})),
        h('label',{class:'f'},'تأكيد كلمة المرور',h('input',{id:'my-pw2',type:'password',dir:'ltr',autocomplete:'new-password'}))),
      h('p',{class:'small muted',style:'margin:0'},'8 خانات على الأقل، فيها حروف وأرقام.'),
      h('div',{id:'my-pw-msg'}),
      h('button',{class:'btn',onclick:async e=>{const a=document.getElementById('my-pw1').value,b=document.getElementById('my-pw2').value,m=document.getElementById('my-pw-msg');
        const say=(t,err)=>{m.innerHTML='';m.appendChild(h('p',{class:'msg'+(err?' err':'')},t))};
        if(a.length<8||!/[a-zA-Z\u0600-\u06FF]/.test(a)||!/[0-9]/.test(a))return say('كلمة المرور 8 خانات على الأقل وتحتوي على حروف وأرقام.',1);
        if(a!==b)return say('التأكيد لا يطابق كلمة المرور.',1);
        e.target.disabled=true;try{await extAuth.setPassword(a);document.getElementById('my-pw1').value='';document.getElementById('my-pw2').value='';say('تم تغيير كلمة المرور. استخدمها في الدخول القادم.')}catch(x){say('تعذّر التغيير: '+((x&&x.message)||''),1)}e.target.disabled=false}},'حفظ كلمة المرور الجديدة')),
    dyn('accList',()=>{
      const L=S.acc.list;
      if(L===null)return h('div',{class:'loading'},S.acc.msg||'جارٍ تحميل الحسابات…');
      const q=S.acc.q.trim().toLowerCase();
      const rows=L.filter(a=>!q||[a.username,a.name,a.phone].join(' ').toLowerCase().includes(q));
      const linked=a=>S.staff.find(s=>s.uid===a.id);
      const state=a=>a.banned?['absent','موقوف']:a.mustChange?['late',a.lastSignIn?'دخل ولم يُنشئ كلمة مرور':'بانتظار التفعيل']:['ok','مفعّل'];
      const act=async(action,a,extra)=>{try{const r=await extAuth.call(action,{uid:a.id});if(action==='reissue')S.acc.issued={name:a.name,username:a.username,code:r.code,phone:a.phone,title:'رمز تفعيل جديد'};accLoad()}catch(e){S.acc.msg=ACC_ERR[e&&e.error]||('تعذّر التنفيذ: '+((e&&e.error)||''));refresh()}};
      const nImam=L.filter(a=>a.role!=='admin').length,nAct=L.filter(a=>a.role!=='admin'&&!a.mustChange&&!a.banned).length;
      return h('div',{class:'panel'},
        h('div',{class:'row spread'},h('h3',null,'الحسابات ('+L.length+')'),h('div',{class:'row'},h('span',{class:'small muted'},nAct+' من '+nImam+' حساب إمام مفعّل'),h('input',{id:'accQ',placeholder:'بحث بالاسم أو الهاتف',style:'width:auto',value:S.acc.q,oninput:e=>{S.acc.q=e.target.value;refresh()}}),h('button',{class:'btn ghost sm',onclick:accLoad},'تحديث'))),
        S.acc.msg?h('p',{class:'msg err'},S.acc.msg):null,
        h('div',{class:'tbl'},h('table',null,
          h('thead',null,h('tr',null,h('th',null,'الاسم'),h('th',null,'اسم المستخدم'),h('th',null,'الهاتف'),h('th',null,'الحالة'),h('th',null,'آخر دخول'),h('th',null,'إجراءات'))),
          h('tbody',null,rows.map(a=>{const[c,l]=state(a),s=linked(a);return h('tr',null,
            h('td',{style:'white-space:normal'},(s&&s.name)||a.name||'—',a.role==='admin'?h('span',{class:'chip ok',style:'margin-inline-start:6px'},'إدارة'):s?h('div',{class:'small muted'},mosque(s.mosqueId)?.name||''):null),
            h('td',{dir:'ltr'},a.username),h('td',null,phoneTxt(a.phone)),h('td',null,h('span',{class:'chip '+c},l)),
            h('td',{class:'small'},a.lastSignIn?new Date(a.lastSignIn).toLocaleString('ar-PS',{dateStyle:'short',timeStyle:'short'}):'—'),
            h('td',null,h('div',{class:'row',style:'flex-wrap:wrap;gap:6px'},
              a.id===S.uid?h('span',{class:'small muted'},'حسابك'):[
              h('button',{class:'btn ghost sm',onclick:()=>act('reissue',a)},a.mustChange?'إعادة إرسال التفعيل':'رمز جديد'),
              h('button',{class:'btn ghost sm',onclick:()=>act(a.banned?'enable':'disable',a)},a.banned?'إعادة التفعيل':'إيقاف'),
              confirmBtn('حذف',()=>act('delete',a))])))})))));
    }));
}


/* ================= استعلام 360 + قوالب الطباعة ================= */
const q3Norm=t=>String(t||'').toLowerCase().replace(/[ً-ْـ]/g,'').replace(/[أإآا]/g,'ا').replace(/ى/g,'ي').replace(/ة/g,'ه').replace(/\s+/g,' ').trim();
const q3Esc=t=>String(t==null?'':t).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const q3Phone=st=>{const ap=S.apps.find(x=>x.id===st.uid);return(ap&&ap.phone)||S.phones[st.id]||st.phone||''};
const q3IdNo=st=>{const ap=S.apps.find(x=>x.id===st.uid);return(ap&&ap.idNo)||''};
const q3User=st=>{const c=st.uid&&S.creds.find(c=>c.id===st.uid);return c?c.username:''};
const Q3SYM={ok:'✓',late:'م',absent:'غ',bad:'ر',leave:'إ',na:'—',pending:'·',open:'·'};
function q3Search(q){
  const n=q3Norm(q);if(!n)return[];
  const hit=v=>q3Norm(v).includes(n);
  const st=S.staff.filter(x=>hit(x.name)||hit(x.role)||hit(q3Phone(x))||hit(q3IdNo(x))||hit(q3User(x))||hit(x.subName)||hit(mosque(x.mosqueId)?.name)).map(x=>({t:'s',id:x.id,name:x.name,sub:[x.role,mosque(x.mosqueId)?.name].filter(Boolean).join(' · ')}));
  const ms=S.mosques.filter(x=>hit(x.name)||hit(x.area)).map(x=>({t:'m',id:x.id,name:x.name,sub:[x.area,S.staff.filter(z=>z.mosqueId===x.id).length+' موظفين'].filter(Boolean).join(' · ')}));
  return[...ms,...st].slice(0,30);
}
function q3StaffData(st){
  const{days,by,rows}=computeMonth(S.month);
  const row=rows.find(r=>r.s.id===st.id)||{exp:0,on:0,late:0,bad:0,abs:0,leave:0,rate:null,les:0};
  const grid=days.map(k=>({k,c:P.map(p=>{const rec=by[st.id]?.[k]?.[p.k];return{st:statusOf(rec,p.k,st,k),rec}})}));
  const lessons=lessonsOf(S.monthDocs).filter(l=>l.staffId===st.id);
  const reports=S.reports.filter(r=>r.staffId===st.id||(!r.staffId&&r.mosqueId===st.mosqueId));
  const leaves=st.uid?leavesOf(st.uid):[];
  const md=st.uid&&S.monthly.find(d=>d.id===st.uid),mr=md&&md.reports&&md.reports[S.month];
  return{days,row,grid,lessons,reports,leaves,mr,rv:st.uid?reviewOf(st.uid,S.month):null};
}
function q3MosqueData(m){
  const{rows}=computeMonth(S.month);
  const staff=rows.filter(r=>r.s.mosqueId===m.id);
  const allStaff=S.staff.filter(x=>x.mosqueId===m.id);
  const sum=staff.reduce((a,r)=>{['exp','on','late','bad','abs','leave','les'].forEach(k=>a[k]+=r[k]);return a},{exp:0,on:0,late:0,bad:0,abs:0,leave:0,les:0});
  sum.rate=sum.exp?Math.round((sum.on+sum.late)/sum.exp*100):null;
  const lessons=lessonsOf(S.monthDocs).filter(l=>l.mosqueId===m.id);
  const reports=S.reports.filter(r=>r.mosqueId===m.id);
  return{staff,allStaff,sum,lessons,reports};
}
const q3Rate=r=>r==null?h('span',{class:'muted small'},'—'):h('span',{class:'chip '+(r>=90?'ok':r>=70?'late':'absent')},r+'%');
const q3Kpi=(n,l,c)=>h('div',{class:'kpi'+(c?' '+c:'')},h('div',{class:'n'},n),h('div',{class:'l'},l));
function q3Card(title,...kids){return h('div',{class:'panel q3card'},h('h3',null,title),...kids)}
function q3Table(head,rows){return h('div',{class:'tbl'},h('table',null,h('thead',null,h('tr',null,head.map(x=>h('th',null,x)))),h('tbody',null,rows)))}

function adminQ360(){
  S.q3=S.q3||{q:'',sel:null};
  const mIn=h('input',{type:'month',value:S.month,style:'width:auto',onchange:e=>{if(e.target.value){S.month=e.target.value;watchMonth();refresh()}}});
  const qIn=h('input',{type:'search',value:S.q3.q,placeholder:'ابحث باسم الإمام أو المسجد أو رقم الهاتف أو الهوية أو اسم المستخدم…',class:'q3search',
    oninput:e=>{S.q3.q=e.target.value;refresh()},onkeydown:e=>{if(e.key==='Enter'){const r=q3Search(S.q3.q);if(r[0]){S.q3.sel={t:r[0].t,id:r[0].id};S.q3.q='';e.target.value='';refresh()}}}});
  return h('div',{style:'display:grid;gap:16px'},
    h('style',null,`.q3search{font-size:1.05rem;padding:12px 16px;border-radius:14px}
.q3res{display:flex;flex-wrap:wrap;gap:8px}.q3res button{font:inherit;cursor:pointer;display:grid;text-align:start;gap:0;padding:8px 14px;border-radius:12px;border:1px solid var(--line);background:var(--surface);transition:transform .2s,box-shadow .2s}
.q3res button:hover{transform:translateY(-2px);box-shadow:0 8px 18px -10px rgba(40,55,30,.5);border-color:var(--olive)}.q3res small{color:var(--muted)}
.q3head{display:flex;flex-wrap:wrap;gap:14px;align-items:center;justify-content:space-between;padding:18px;border-radius:16px;color:#fff;background:linear-gradient(135deg,var(--olive),#2b3b20)}
.q3head h2{color:#fff;font-weight:700}.q3head p{margin:2px 0 0;opacity:.9;font-size:.88rem}.q3head .btn{background:rgba(255,255,255,.16);border:1px solid rgba(255,255,255,.35);color:#fff}
.q3grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,320px),1fr));gap:16px;align-items:start}
.q3cal{display:grid;grid-template-columns:auto repeat(5,1fr);gap:3px;font-size:.78rem;text-align:center}
.q3cal b{font-weight:600;color:var(--muted)}.q3cal span{border-radius:5px;padding:2px 0;font-weight:700}
.q3-ok{background:var(--ok-bg);color:var(--ok)}.q3-late{background:var(--warn-bg);color:var(--warn)}.q3-absent,.q3-bad{background:var(--bad-bg);color:var(--bad)}.q3-leave{background:#e3e9f6;color:#3b5a9a}.q3-na,.q3-pending,.q3-open{background:var(--idle-bg);color:var(--idle)}
.q3dl{display:grid;grid-template-columns:auto 1fr;gap:4px 14px;margin:0;font-size:.9rem}.q3dl dt{color:var(--muted)}.q3dl dd{margin:0;font-weight:600}
.q3prints{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,210px),1fr));gap:10px}
.q3prints button{font:inherit;cursor:pointer;display:flex;gap:10px;align-items:center;text-align:start;padding:12px;border-radius:14px;border:1px solid var(--line);background:var(--surface);transition:transform .2s,box-shadow .2s}
.q3prints button:hover{transform:translateY(-2px);box-shadow:0 10px 22px -12px rgba(40,55,30,.55);border-color:var(--olive)}
.q3prints .gico{flex:none;width:36px;height:36px;border-radius:10px;display:grid;place-items:center;color:var(--olive);background:color-mix(in srgb,var(--olive) 13%,transparent)}
.q3prints small{display:block;color:var(--muted);font-size:.78rem}`),
    h('div',{class:'row spread'},h('h2',null,'استعلام 360'),h('label',{class:'row small muted'},'الشهر',mIn)),
    qIn,
    dyn('q3res',()=>{const r=q3Search(S.q3.q);if(!S.q3.q)return[];
      if(!r.length)return h('p',{class:'muted small'},'لا نتائج مطابقة.');
      return h('div',{class:'q3res'},r.map(x=>h('button',{type:'button',onclick:()=>{S.q3.sel={t:x.t,id:x.id};S.q3.q='';qIn.value='';refresh()}},h('b',null,(x.t==='m'?'🕌 ':'👤 ')+x.name),h('small',null,x.sub))))}),
    dyn('q3body',()=>{
      const sel=S.q3.sel;
      if(sel&&sel.t==='s'){const st=staffBy(sel.id);if(st)return q3StaffView(st)}
      if(sel&&sel.t==='m'){const m=mosque(sel.id);if(m)return q3MosqueView(m)}
      return q3Overview();
    }));
}
function q3Back(){return h('button',{class:'btn ghost sm',type:'button',onclick:()=>{S.q3.sel=null;refresh()}},'← العودة إلى النظرة العامة')}
function q3Overview(){
  const{rows}=computeMonth(S.month);
  const act=rows.filter(r=>r.rate!=null),avg=act.length?Math.round(act.reduce((a,r)=>a+r.rate,0)/act.length):null;
  const open=S.reports.filter(r=>repStatus(r)!=='done').length,les=lessonsOf(S.monthDocs).length;
  const pendLv=S.staff.filter(x=>x.uid).reduce((n,x)=>n+leavesOf(x.uid).filter(l=>!l.dec&&!l.cancelled).length,0);
  return h('div',{style:'display:grid;gap:16px'},
    h('div',{class:'kpis'},q3Kpi(S.mosques.length,'مسجد'),q3Kpi(S.staff.length,'إمام ومؤذن وآذن'),q3Kpi(avg==null?'—':avg+'%','متوسط الالتزام في '+monthAr(S.month),avg!=null&&avg<70?'bad':avg!=null&&avg<90?'warn':''),q3Kpi(les,'درس هذا الشهر'),q3Kpi(open,'بلاغ مفتوح',open?'warn':''),q3Kpi(pendLv,'إجازة بانتظار القرار',pendLv?'warn':'')),
    q3Card('قوالب الطباعة',h('p',{class:'muted small',style:'margin:0'},'تقارير جاهزة بترويسة المديرية وخانات التوقيع، لشهر '+monthAr(S.month)+'. لطباعة ملف إمام أو مسجد ابحث عنه أولاً.'),
      h('div',{class:'q3prints'},
        q3PrintBtn('month','تقرير الحضور الشهري العام','جميع الأئمة ونسب الالتزام',()=>q3Print('month')),
        q3PrintBtn('mosques','تقرير المساجد','الالتزام والدروس والبلاغات لكل مسجد',()=>q3Print('mosques')),
        q3PrintBtn('lessons','سجل الدروس','كل الدروس المسجّلة في الشهر',()=>q3Print('lessons')),
        q3PrintBtn('reports','تقرير البلاغات','المفتوحة والمغلقة',()=>q3Print('reports')),
        q3PrintBtn('leaves','تقرير الإجازات','الطلبات والقرارات',()=>q3Print('leaves')),
        q3PrintBtn('staff','دليل الأئمة والمؤذنين','الأسماء والمساجد والهواتف',()=>q3Print('directory')))),
    h('div',{class:'q3grid'},
      q3Card('الأقل التزاماً هذا الشهر',act.length?q3Table(['الاسم','المسجد','الالتزام'],act.slice(0,8).map(r=>h('tr',{style:'cursor:pointer',onclick:()=>{S.q3.sel={t:'s',id:r.s.id};refresh()}},h('td',null,r.s.name),h('td',{class:'muted'},mosque(r.s.mosqueId)?.name||'—'),h('td',null,q3Rate(r.rate))))):h('p',{class:'muted small'},'لا بيانات حضور بعد.')),
      q3Card('المساجد',S.mosques.length?q3Table(['المسجد','الموظفون','الالتزام','بلاغات مفتوحة'],S.mosques.map(m=>{const d=q3MosqueData(m);return h('tr',{style:'cursor:pointer',onclick:()=>{S.q3.sel={t:'m',id:m.id};refresh()}},h('td',null,m.name),h('td',{class:'num'},d.allStaff.length),h('td',null,q3Rate(d.sum.rate)),h('td',{class:'num'},d.reports.filter(r=>repStatus(r)!=='done').length))})):h('p',{class:'muted small'},'لا مساجد بعد.'))));
}
function q3PrintBtn(icon,t,sub,fn){return h('button',{type:'button',onclick:fn},gIcon('printer'),h('span',null,h('b',null,t),h('small',null,sub)))}
function q3Cal(grid){
  return h('div',{class:'q3cal'},h('b',null,'اليوم'),P.map(p=>h('b',null,p.n)),
    grid.slice().reverse().flatMap(g=>[h('b',null,+g.k.slice(8)),...g.c.map((c,i)=>h('span',{class:'q3-'+c.st,title:(ST[c.st]||'')+(c.rec&&c.rec.at?' '+fmtT(new Date(c.rec.at)):'')},Q3SYM[c.st]||'·'))]));
}
function q3StaffView(st){
  const d=q3StaffData(st),m=mosque(st.mosqueId),r=d.row;
  const yr=S.month.slice(0,4);
  return h('div',{style:'display:grid;gap:16px'},
    q3Back(),
    h('div',{class:'q3head'},h('div',null,h('h2',null,st.name),h('p',null,[st.role,m?.name,m?.area].filter(Boolean).join(' · '))),
      h('button',{class:'btn',type:'button',onclick:()=>q3Print('staff',st)},gIcon('printer'),' طباعة ملف 360')),
    h('div',{class:'kpis'},q3Kpi(r.rate==null?'—':r.rate+'%','نسبة الالتزام',r.rate!=null&&r.rate<70?'bad':r.rate!=null&&r.rate<90?'warn':''),q3Kpi(r.on,'في الوقت'),q3Kpi(r.late,'متأخر','warn'),q3Kpi(r.abs,'غياب','bad'),q3Kpi(r.bad,'مرفوض','bad'),q3Kpi(r.leave,'صلوات بإجازة'),q3Kpi(d.lessons.length,'دروس')),
    h('div',{class:'q3grid'},
      q3Card('البيانات الأساسية',h('dl',{class:'q3dl'},
        h('dt',null,'الصفة'),h('dd',null,st.role||'—'),h('dt',null,'المسجد'),h('dd',null,m?h('a',{href:'#',onclick:e=>{e.preventDefault();S.q3.sel={t:'m',id:m.id};refresh()}},m.name):'—'),
        h('dt',null,'الهاتف'),h('dd',null,phoneTxt(q3Phone(st))),h('dt',null,'رقم الهوية'),h('dd',null,q3IdNo(st)||'—'),
        h('dt',null,'اسم المستخدم'),h('dd',{dir:'ltr',style:'text-align:right'},q3User(st)||'—'),h('dt',null,'الحساب'),h('dd',null,st.uid?'مفعّل':'دون حساب'),
        h('dt',null,'الإمام البديل'),h('dd',null,st.subName||'—'),h('dt',null,'الصلوات المكلّف بها'),h('dd',null,(st.duties||P.map(p=>p.k)).map(k=>P.find(p=>p.k===k)?.n).join('، ')),
        h('dt',null,'التقرير الشهري'),h('dd',null,d.mr?(d.mr.status==='sent'?(d.rv&&d.rv.status==='reviewed'?'أُرسل وروجع':'أُرسل، بانتظار المراجعة'):'مسودة'):'لم يُرسل'),
        h('dt',null,'إجازات سنوية '+yr),h('dd',null,st.uid?usedDays(st.uid,'إجازة سنوية',yr)+' يوماً':'—'))),
      q3Card('سجل الحضور — '+monthAr(S.month),d.grid.length?q3Cal(d.grid):h('p',{class:'muted small'},'لا أيام بعد.'),h('p',{class:'muted small',style:'margin:0'},'✓ في الوقت · م متأخر · غ غياب · ر مرفوض · إ إجازة · — غير مكلّف'))),
    h('div',{class:'q3grid'},
      q3Card('الدروس ('+d.lessons.length+')',d.lessons.length?h('div',{class:'list'},d.lessons.slice(0,20).map(lessonItem)):h('p',{class:'muted small'},'لا دروس في هذا الشهر.')),
      q3Card('الإجازات ('+d.leaves.length+')',d.leaves.length?q3Table(['النوع','من','إلى','الحالة'],d.leaves.slice(0,20).map(l=>h('tr',null,h('td',null,l.type),h('td',null,l.from),h('td',null,l.to),h('td',null,h('span',{class:'chip '+leaveState(l)[0]},leaveState(l)[1]))))):h('p',{class:'muted small'},'لا إجازات.')),
      q3Card('البلاغات ('+d.reports.length+')',d.reports.length?h('div',{class:'list'},d.reports.slice(0,15).map(x=>reportItem(x,false))):h('p',{class:'muted small'},'لا بلاغات.'))));
}
function q3MosqueView(m){
  const d=q3MosqueData(m),open=d.reports.filter(r=>repStatus(r)!=='done');
  return h('div',{style:'display:grid;gap:16px'},
    q3Back(),
    h('div',{class:'q3head'},h('div',null,h('h2',null,m.name),h('p',null,[m.area,d.allStaff.length+' موظفين'].filter(Boolean).join(' · '))),
      h('button',{class:'btn',type:'button',onclick:()=>q3Print('mosque',m)},gIcon('printer'),' طباعة تقرير المسجد')),
    h('div',{class:'kpis'},q3Kpi(d.sum.rate==null?'—':d.sum.rate+'%','التزام المسجد',d.sum.rate!=null&&d.sum.rate<70?'bad':d.sum.rate!=null&&d.sum.rate<90?'warn':''),q3Kpi(d.sum.on,'في الوقت'),q3Kpi(d.sum.late,'متأخر','warn'),q3Kpi(d.sum.abs,'غياب','bad'),q3Kpi(d.lessons.length,'دروس'),q3Kpi(open.length,'بلاغ مفتوح',open.length?'warn':'')),
    h('div',{class:'q3grid'},
      q3Card('الكادر',d.allStaff.length?q3Table(['الاسم','الصفة','الالتزام','الهاتف'],d.allStaff.map(x=>{const r=d.staff.find(y=>y.s.id===x.id);return h('tr',{style:'cursor:pointer',onclick:()=>{S.q3.sel={t:'s',id:x.id};refresh()}},h('td',null,x.name),h('td',{class:'muted'},x.role),h('td',null,q3Rate(r?r.rate:null)),h('td',null,phoneTxt(q3Phone(x))))})):h('p',{class:'muted small'},'لا موظفين.')),
      q3Card('البلاغات ('+d.reports.length+')',d.reports.length?h('div',{class:'list'},d.reports.slice(0,15).map(x=>reportItem(x,false))):h('p',{class:'muted small'},'لا بلاغات.'))),
    q3Card('الدروس ('+d.lessons.length+')',d.lessons.length?h('div',{class:'list'},d.lessons.slice(0,20).map(lessonItem)):h('p',{class:'muted small'},'لا دروس في هذا الشهر.')));
}

/* ---------- print templates ---------- */
function q3Doc(title,sub,body){
  const now=new Date();
  return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>${q3Esc(title)}</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;800&display=swap">
<style>@page{size:A4;margin:14mm 12mm}*{box-sizing:border-box}body{font-family:Cairo,Tahoma,sans-serif;color:#1d241b;font-size:11.5pt;margin:0;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.lh{display:flex;align-items:center;justify-content:space-between;border-bottom:3px double #4c6a37;padding-bottom:8px;margin-bottom:12px}
.lh .r{display:flex;gap:10px;align-items:center}.lh b{display:block;font-size:13pt}.lh small{color:#555;font-size:9.5pt}.lh .l{text-align:left;font-size:9pt;color:#555}
h1{font-size:16pt;margin:4px 0 2px;color:#2f4a22}.sub{color:#555;margin:0 0 10px;font-size:10pt}
h2{font-size:12pt;margin:14px 0 6px;color:#2f4a22;border-inline-start:4px solid #c9a24a;padding-inline-start:8px}
table{width:100%;border-collapse:collapse;font-size:10pt;page-break-inside:auto}tr{page-break-inside:avoid}
th{background:#e7eddf;font-weight:700}th,td{border:1px solid #b9c2ad;padding:4px 6px;text-align:right}td.c,th.c{text-align:center}
.kp{display:flex;flex-wrap:wrap;gap:6px;margin:6px 0}.kp div{flex:1;min-width:90px;border:1px solid #c9d1bd;border-radius:6px;padding:4px 8px}.kp b{display:block;font-size:14pt}.kp span{font-size:8.5pt;color:#555}
.ok{background:#dcefe2;color:#226b3d}.late{background:#f6ebcf;color:#8a5d0c}.absent,.bad{background:#f6dcd8;color:#9a2f24}.leave{background:#e3e9f6;color:#3b5a9a}.na,.pending,.open{color:#999}
dl{display:grid;grid-template-columns:auto 1fr auto 1fr;gap:3px 12px;margin:0}dt{color:#555}dd{margin:0;font-weight:700}
.sig{display:flex;justify-content:space-between;margin-top:36px;gap:20px}.sig div{flex:1;text-align:center;border-top:1px dotted #777;padding-top:4px;font-size:10pt}
.ft{margin-top:14px;font-size:8.5pt;color:#777;text-align:center}.muted{color:#777}</style></head><body>
<div class="lh"><div class="r"><svg width="46" height="46" viewBox="0 0 44 44"><rect x="1" y="1" width="42" height="42" rx="9" fill="#4c6a37"/><path d="M22 8c-6 4-10 8-10 14v1h20v-1c0-6-4-10-10-14z" fill="#fff"/><rect x="12" y="24" width="20" height="12" fill="#fff"/><rect x="19" y="28" width="6" height="8" fill="#4c6a37"/></svg>
<div><b>دولة فلسطين — وزارة الأوقاف والشؤون الدينية</b><small>مديرية أوقاف نابلس · نظام متابعة المساجد</small></div></div>
<div class="l">تاريخ الطباعة<br><b>${q3Esc(now.toLocaleDateString('ar-PS',{day:'numeric',month:'long',year:'numeric'}))}</b></div></div>
<h1>${q3Esc(title)}</h1><p class="sub">${q3Esc(sub)}</p>${body}
<div class="sig"><div>مُعِدّ التقرير</div><div>رئيس قسم الوعظ والإرشاد</div><div>مدير أوقاف نابلس</div></div>
<div class="ft">صدر من نظام متابعة مساجد نابلس · ${q3Esc(location.host)}</div></body></html>`;
}
const q3T=(head,rows)=>'<table><thead><tr>'+head.map(x=>'<th>'+q3Esc(x)+'</th>').join('')+'</tr></thead><tbody>'+(rows.length?rows.join(''):'<tr><td colspan="'+head.length+'" class="c muted">لا توجد بيانات</td></tr>')+'</tbody></table>';
const q3R=cells=>'<tr>'+cells.map(c=>typeof c==='object'&&c?'<td class="'+(c.cls||'')+'">'+q3Esc(c.v)+'</td>':'<td>'+q3Esc(c)+'</td>').join('')+'</tr>';
const q3Kp=items=>'<div class="kp">'+items.map(([n,l])=>'<div><b>'+q3Esc(n)+'</b><span>'+q3Esc(l)+'</span></div>').join('')+'</div>';
const q3RateCell=r=>({v:r==null?'—':r+'%',cls:'c '+(r==null?'':r>=90?'ok':r>=70?'late':'absent')});
function q3Print(kind,obj){
  const mk=S.month,ma=monthAr(mk);let title='',sub='الفترة: '+ma,body='';
  if(kind==='staff'){const st=obj,d=q3StaffData(st),m=mosque(st.mosqueId),r=d.row;title='ملف 360 — '+st.name;
    body='<h2>البيانات الأساسية</h2><dl><dt>الصفة</dt><dd>'+q3Esc(st.role||'—')+'</dd><dt>المسجد</dt><dd>'+q3Esc(m?.name||'—')+'</dd><dt>الهاتف</dt><dd dir="ltr" style="text-align:right">'+q3Esc(q3Phone(st)||'—')+'</dd><dt>رقم الهوية</dt><dd>'+q3Esc(q3IdNo(st)||'—')+'</dd><dt>الإمام البديل</dt><dd>'+q3Esc(st.subName||'—')+'</dd><dt>اسم المستخدم</dt><dd>'+q3Esc(q3User(st)||'—')+'</dd></dl>'
      +'<h2>مؤشرات الشهر</h2>'+q3Kp([[r.rate==null?'—':r.rate+'%','نسبة الالتزام'],[r.exp,'صلوات مطلوبة'],[r.on,'في الوقت'],[r.late,'متأخر'],[r.abs,'غياب'],[r.bad,'مرفوض'],[r.leave,'بإجازة'],[d.lessons.length,'دروس']])
      +'<h2>سجل الحضور اليومي</h2>'+q3T(['اليوم',...P.map(p=>p.n)],d.grid.map(g=>q3R([new Date(g.k+'T12:00').toLocaleDateString('ar-PS',{weekday:'short',day:'numeric'}),...g.c.map(c=>({v:(ST[c.st]||'')+(c.rec&&c.rec.at&&(c.st==='ok'||c.st==='late')?' '+fmtT(new Date(c.rec.at)):''),cls:'c '+c.st}))])))
      +'<h2>الدروس</h2>'+q3T(['التاريخ','الموضوع','النوع','الحضور','المدة'],d.lessons.map(l=>q3R([l.date,l.topic,l.type||'',{v:l.attendees||0,cls:'c'},{v:(l.duration||0)+' د',cls:'c'}])))
      +'<h2>الإجازات</h2>'+q3T(['النوع','من','إلى','الأيام','الحالة'],d.leaves.map(l=>q3R([l.type,l.from,l.to,{v:daysBetween(l.from,l.to),cls:'c'},leaveState(l)[1]])))
      +'<h2>البلاغات</h2>'+q3T(['التاريخ','الفئة','الأهمية','الحالة','التفاصيل'],d.reports.map(x=>q3R([x.date,x.category,SEV[x.severity]||'',RST[repStatus(x)]||'',x.notes||''])));
  }else if(kind==='mosque'){const m=obj,d=q3MosqueData(m);title='تقرير المسجد — '+m.name;sub=[m.area,'الفترة: '+ma].filter(Boolean).join(' · ');
    body=q3Kp([[d.sum.rate==null?'—':d.sum.rate+'%','التزام المسجد'],[d.allStaff.length,'الموظفون'],[d.sum.on,'في الوقت'],[d.sum.late,'متأخر'],[d.sum.abs,'غياب'],[d.lessons.length,'دروس'],[d.reports.filter(r=>repStatus(r)!=='done').length,'بلاغات مفتوحة']])
      +'<h2>الكادر</h2>'+q3T(['الاسم','الصفة','الهاتف','المطلوب','في الوقت','متأخر','غياب','الالتزام'],d.allStaff.map(x=>{const r=d.staff.find(y=>y.s.id===x.id)||{};return q3R([x.name,x.role||'',q3Phone(x),{v:r.exp??'—',cls:'c'},{v:r.on??'—',cls:'c'},{v:r.late??'—',cls:'c'},{v:r.abs??'—',cls:'c'},q3RateCell(r.rate??null)])}))
      +'<h2>الدروس</h2>'+q3T(['التاريخ','الموضوع','المُلقي','الحضور'],d.lessons.map(l=>q3R([l.date,l.topic,staffBy(l.staffId)?.name||'',{v:l.attendees||0,cls:'c'}])))
      +'<h2>البلاغات</h2>'+q3T(['التاريخ','الفئة','الأهمية','الحالة','التفاصيل'],d.reports.map(x=>q3R([x.date,x.category,SEV[x.severity]||'',RST[repStatus(x)]||'',x.notes||''])));
  }else if(kind==='month'){const{days,rows}=computeMonth(mk);title='تقرير الحضور الشهري العام';sub='الفترة: '+ma+' · محسوب على '+days.length+' يوماً';
    const act=rows.filter(r=>r.rate!=null),avg=act.length?Math.round(act.reduce((a,r)=>a+r.rate,0)/act.length):null;
    body=q3Kp([[rows.length,'موظفون بحسابات'],[avg==null?'—':avg+'%','متوسط الالتزام'],[act.filter(r=>r.rate>=90).length,'التزام ممتاز (90%+)'],[act.filter(r=>r.rate<70).length,'التزام ضعيف (أقل من 70%)']])
      +q3T(['#','الاسم','الصفة','المسجد','المطلوب','في الوقت','متأخر','غياب','مرفوض','إجازة','الالتزام','الدروس'],rows.map((r,i)=>q3R([{v:i+1,cls:'c'},r.s.name,r.s.role||'',mosque(r.s.mosqueId)?.name||'—',{v:r.exp,cls:'c'},{v:r.on,cls:'c'},{v:r.late,cls:'c'},{v:r.abs,cls:'c'},{v:r.bad,cls:'c'},{v:r.leave,cls:'c'},q3RateCell(r.rate),{v:r.les,cls:'c'}])));
  }else if(kind==='mosques'){title='تقرير المساجد';
    body=q3T(['#','المسجد','الموقع','الموظفون','الالتزام','الدروس','بلاغات مفتوحة','بلاغات مغلقة'],S.mosques.map((m,i)=>{const d=q3MosqueData(m);return q3R([{v:i+1,cls:'c'},m.name,m.area||'',{v:d.allStaff.length,cls:'c'},q3RateCell(d.sum.rate),{v:d.lessons.length,cls:'c'},{v:d.reports.filter(r=>repStatus(r)!=='done').length,cls:'c'},{v:d.reports.filter(r=>repStatus(r)==='done').length,cls:'c'}])}));
  }else if(kind==='lessons'){const L=lessonsOf(S.monthDocs);title='سجل الدروس والأنشطة';
    body=q3Kp([[L.length,'درساً'],[L.reduce((a,l)=>a+(+l.attendees||0),0),'إجمالي الحضور'],[new Set(L.map(l=>l.mosqueId)).size,'مسجداً']])
      +q3T(['التاريخ','الموضوع','النوع','المسجد','المُلقي','الحضور','المدة'],L.map(l=>q3R([l.date,l.topic,l.type||'',mosque(l.mosqueId)?.name||'',staffBy(l.staffId)?.name||'',{v:l.attendees||0,cls:'c'},{v:(l.duration||0)+' د',cls:'c'}])));
  }else if(kind==='reports'){const all=S.reports,open=all.filter(r=>repStatus(r)!=='done');title='تقرير بلاغات المساجد';sub='حتى تاريخه';
    body=q3Kp([[open.filter(r=>r.severity==='high').length,'عاجل مفتوح'],[open.length,'مفتوح'],[all.length-open.length,'مغلق']])
      +'<h2>المفتوحة</h2>'+q3T(['التاريخ','المسجد','الفئة','الأهمية','الحالة','المُبلِّغ','التفاصيل'],open.map(x=>q3R([x.date,mosque(x.mosqueId)?.name||'',x.category,SEV[x.severity]||'',RST[repStatus(x)]||'',staffBy(x.staffId)?.name||'',x.notes||''])))
      +'<h2>المغلقة</h2>'+q3T(['التاريخ','المسجد','الفئة','التفاصيل'],all.filter(r=>repStatus(r)==='done').map(x=>q3R([x.date,mosque(x.mosqueId)?.name||'',x.category,x.notes||''])));
  }else if(kind==='leaves'){title='تقرير الإجازات';
    const L=S.staff.filter(x=>x.uid).flatMap(x=>leavesOf(x.uid).map(l=>({l,x}))).filter(({l})=>(l.from||'').slice(0,7)<=mk&&(l.to||'').slice(0,7)>=mk);
    body=q3T(['الاسم','المسجد','النوع','من','إلى','الأيام','الحالة','البديل'],L.map(({l,x})=>q3R([x.name,mosque(x.mosqueId)?.name||'',l.type,l.from,l.to,{v:daysBetween(l.from,l.to),cls:'c'},leaveState(l)[1],l.subName||l.substitute||''])));
  }else if(kind==='directory'){title='دليل الأئمة والمؤذنين';sub='حتى تاريخه';
    const list=S.staff.slice().sort((a,b)=>(mosque(a.mosqueId)?.name||'').localeCompare(mosque(b.mosqueId)?.name||'','ar'));
    body=q3T(['#','الاسم','الصفة','المسجد','الهاتف','الحساب'],list.map((x,i)=>q3R([{v:i+1,cls:'c'},x.name,x.role||'',mosque(x.mosqueId)?.name||'',q3Phone(x),x.uid?'مفعّل':'—'])));
  }
  const html=q3Doc(title,sub,body);
  const fr=document.createElement('iframe');fr.style.cssText='position:fixed;width:0;height:0;border:0;left:-9999px';document.body.append(fr);
  const dc=fr.contentDocument;dc.open();dc.write(html);dc.close();
  const go=()=>{try{fr.contentWindow.focus();fr.contentWindow.print()}catch(e){const w=window.open('','_blank');if(w){w.document.write(html);w.document.close();setTimeout(()=>w.print(),600)}}setTimeout(()=>fr.remove(),60000)};
  (dc.fonts&&dc.fonts.ready?dc.fonts.ready:Promise.resolve()).then(()=>setTimeout(go,300));
}

/* ================= Live header + glass tabs (admin) ================= */
const{gIcon,gRipple,liveHeader}=(()=>{
const G_ICONS={
  q360:'<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/><path d="M11 7v4l2.5 1.5"/>',
  printer:'<path d="M6 9V2h12v7"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect width="12" height="8" x="6" y="14"/>',
  accounts:'<rect width="14" height="20" x="5" y="2" rx="2"/><path d="M12 18h.01"/>',
  apps:'<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M19 8v6"/><path d="M22 11h-6"/>',
  today:'<rect width="8" height="4" x="8" y="2" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="m9 14 2 2 4-4"/>',
  monthly:'<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M16 13H8"/><path d="M16 17H8"/><path d="M10 9H8"/>',
  messages:'<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/><path d="M8 12h.01"/><path d="M12 12h.01"/><path d="M16 12h.01"/>',
  leaves:'<rect width="18" height="18" x="3" y="4" rx="2"/><path d="M16 2v4"/><path d="M8 2v4"/><path d="M3 10h18"/><path d="m14 14-4 4"/><path d="m10 14 4 4"/>',
  month:'<path d="M3 3v18h18"/><path d="M18 17V9"/><path d="M13 17V5"/><path d="M8 17v-3"/>',
  lessons:'<path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>',
  reports:'<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
  mosques:'<path d="M4 21V10"/><path d="M3 10h2"/><path d="M4 7V6"/><path d="M8 21v-7a6 6 0 0 1 12 0v7"/><path d="M14 8V5"/><path d="M3 21h18"/><path d="M12 21v-3a2 2 0 0 1 4 0v3"/>',
  staff:'<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  clock:'<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
  moon:'<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>',
  pin:'<path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/>',
  bell:'<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>'
};
function gIcon(k,cls){const sp=document.createElement('span');sp.className='gico '+(cls||'');sp.setAttribute('aria-hidden','true');
  sp.innerHTML='<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'+(G_ICONS[k]||'')+'</svg>';return sp}
function gRipple(e){const b=e.currentTarget;if(!b)return;const r=b.getBoundingClientRect(),d=document.createElement('i');d.className='gripple';
  const z=Math.max(r.width,r.height);d.style.cssText='width:'+z+'px;height:'+z+'px;left:'+(e.clientX-r.left-z/2)+'px;top:'+(e.clientY-r.top-z/2)+'px';b.append(d);setTimeout(()=>d.remove(),650)}

const GOVS=[['نابلس',32.2211,35.2544],['جنين',32.4610,35.2950],['طوباس',32.3209,35.3699],['طولكرم',32.3104,35.0286],['قلقيلية',32.1896,34.9706],['سلفيت',32.0833,35.1806],['رام الله',31.9038,35.2034],['أريحا',31.8667,35.4500],['القدس',31.7683,35.2137],['بيت لحم',31.7054,35.2024],['الخليل',31.5326,35.0998],['غزة',31.5017,34.4668],['خان يونس',31.3462,34.3063],['رفح',31.2969,34.2455]];
const TZ='Asia/Hebron';
function govTimes(day,lat,lng){
  const dg=Math.PI/180,sin=x=>Math.sin(x*dg),cos=x=>Math.cos(x*dg);
  const acos=x=>Math.acos(Math.max(-1,Math.min(1,x)))/dg,asin=x=>Math.asin(x)/dg,atan2=(y,x)=>Math.atan2(y,x)/dg;
  const fix=(a,b)=>{a=a-b*Math.floor(a/b);return a<0?a+b:a};
  let y=day.getFullYear(),m=day.getMonth()+1,d=day.getDate();if(m<=2){y--;m+=12}
  const A=Math.floor(y/100),B=2-A+Math.floor(A/4);
  const jd=Math.floor(365.25*(y+4716))+Math.floor(30.6001*(m+1))+d+B-1524.5+0.5-lng/360;
  const D=jd-2451545,g=fix(357.529+0.98560028*D,360),q=fix(280.459+0.98564736*D,360);
  const L=fix(q+1.915*sin(g)+0.020*sin(2*g),360),e=23.439-0.00000036*D;
  const RA=fix(atan2(cos(e)*sin(L),cos(L))/15,24),decl=asin(sin(e)*sin(L)),eqt=((q/15-RA+12)%24+24)%24-12;
  const noon=12-lng/15-eqt;
  const T=a=>acos((-sin(a)-sin(decl)*sin(lat))/(cos(decl)*cos(lat)))/15;
  const asrA=acos((sin(Math.atan(1/(1+Math.tan(Math.abs(lat-decl)*dg)))/dg)-sin(decl)*sin(lat))/(cos(decl)*cos(lat)))/15;
  const base=Date.UTC(day.getFullYear(),day.getMonth(),day.getDate());
  const at=hrs=>new Date(Math.ceil((base+hrs*3600e3)/60000)*60000);
  return{fajr:at(noon-T(19.5)),sunrise:at(noon-T(0.833)),dhuhr:at(noon+2/60),asr:at(noon+asrA),maghrib:at(noon+T(0.833)+2/60),isha:at(noon+T(17.5))};
}
const GP=[['fajr','الفجر'],['sunrise','الشروق'],['dhuhr','الظهر'],['asr','العصر'],['maghrib','المغرب'],['isha','العشاء']];
const fmtT=d=>d.toLocaleTimeString('ar-EG-u-nu-latn',{hour:'numeric',minute:'2-digit',timeZone:TZ});
function localDay(off){const p=new Intl.DateTimeFormat('en-CA',{timeZone:TZ,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(Date.now()+off*864e5)).split('-');return new Date(+p[0],+p[1]-1,+p[2])}
function nextPrayer(lat,lng,isNablus){
  const now=Date.now();
  for(let off=0;off<2;off++){const day=localDay(off);let t=govTimes(day,lat,lng);
    if(isNablus&&typeof prayerTimes==='function'){try{const o=prayerTimes(day);t={...t,...o}}catch(_){}}
    for(const[k,n]of GP){if(k==='sunrise')continue;if(t[k].getTime()>now){const prev=GP.filter(x=>x[0]!=='sunrise').map(x=>t[x[0]].getTime()).filter(v=>v<=now).pop();return{k,n:(k==='dhuhr'&&day.getDay()===5)?'الجمعة':n,at:t[k],prev:prev||(t[k].getTime()-6*3600e3),all:t}}}}
}
const pad=n=>String(n).padStart(2,'0');
function left(ms){const s=Math.max(0,Math.floor(ms/1000)),hh=Math.floor(s/3600),mm=Math.floor(s%3600/60),ss=s%60;return hh?hh+':'+pad(mm)+':'+pad(ss):pad(mm)+':'+pad(ss)}

function liveHeader(){
  if(document.getElementById('liveHdr'))return;
  const st=document.createElement('style');st.textContent=`
#liveHdr{position:sticky;top:0;z-index:50;margin:0 calc(-1*max(16px,env(safe-area-inset-left,0px)));padding:10px max(16px,env(safe-area-inset-left,0px)) 10px;
  background:linear-gradient(120deg,color-mix(in srgb,var(--olive) 88%,#000) 0%,color-mix(in srgb,var(--olive) 70%,#1d2a14) 55%,#2b3b20 100%);color:#fff;
  box-shadow:0 10px 30px -12px rgba(20,30,15,.55);overflow:hidden;isolation:isolate}
#liveHdr::before{content:"";position:absolute;inset:-40% -10%;z-index:-1;background:radial-gradient(40% 60% at 15% 30%,rgba(201,162,74,.35),transparent 60%),radial-gradient(35% 55% at 85% 70%,rgba(255,255,255,.12),transparent 60%);animation:gDrift 18s ease-in-out infinite alternate}
@keyframes gDrift{to{transform:translate3d(6%,4%,0) rotate(4deg)}}
#liveHdr .lh-in{max-width:1080px;margin:0 auto;display:grid;gap:10px}
#liveHdr .lh-top{display:flex;flex-wrap:wrap;gap:10px 18px;align-items:center;justify-content:space-between}
.lh-clock{display:flex;align-items:center;gap:10px}
.lh-clock .gico{width:38px;height:38px;border-radius:12px;display:grid;place-items:center;background:rgba(255,255,255,.14);border:1px solid rgba(255,255,255,.25);backdrop-filter:blur(8px)}
.lh-clock .gico svg{animation:gSpin 60s linear infinite}
@keyframes gSpin{to{transform:rotate(360deg)}}
.lh-time{font-size:1.7rem;font-weight:800;letter-spacing:.04em;font-variant-numeric:tabular-nums;direction:ltr;unicode-bidi:isolate;text-align:right;line-height:1}
.lh-time i{font-style:normal;opacity:.55;font-size:1rem;margin-inline-start:2px}
.lh-date{font-size:.8rem;opacity:.9;line-height:1.35}.lh-date b{font-weight:700}
.lh-next{display:flex;align-items:center;gap:10px;padding:6px 14px 6px 8px;border-radius:999px;background:rgba(255,255,255,.14);border:1px solid rgba(255,255,255,.28);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px)}
.lh-ring{--p:0;width:40px;height:40px;border-radius:50%;display:grid;place-items:center;background:conic-gradient(#e7c26a calc(var(--p)*1%),rgba(255,255,255,.18) 0);position:relative}
.lh-ring::after{content:"";position:absolute;inset:4px;border-radius:50%;background:#33452a}
.lh-ring .gico{position:relative;z-index:1;color:#f3d98f}.lh-ring .gico svg{width:18px;height:18px}
.lh-next.soon .lh-ring{animation:gPulse 1.6s ease-out infinite}
.lh-next small{display:block;font-size:.72rem;opacity:.85}.lh-next b{font-size:.98rem}.lh-next .cd{font-variant-numeric:tabular-nums;direction:ltr;display:inline-block;font-weight:700;color:#f3d98f}
.lh-strip{position:relative;overflow:hidden;mask-image:linear-gradient(90deg,transparent,#000 4%,#000 96%,transparent);-webkit-mask-image:linear-gradient(90deg,transparent,#000 4%,#000 96%,transparent)}
.lh-track{display:flex;gap:8px;width:max-content;animation:gMarq 70s linear infinite}
.lh-strip:hover .lh-track{animation-play-state:paused}
@keyframes gMarq{from{transform:translateX(0)}to{transform:translateX(50%)}}
.gov{display:flex;align-items:center;gap:8px;padding:5px 12px;border-radius:12px;background:rgba(255,255,255,.10);border:1px solid rgba(255,255,255,.18);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);white-space:nowrap;font-size:.82rem;cursor:default;transition:background .25s,transform .25s}
.gov:hover{background:rgba(255,255,255,.22);transform:translateY(-2px)}
.gov .nm{font-weight:700}.gov .pn{opacity:.8}.gov .tm{font-weight:800;color:#f3d98f;font-variant-numeric:tabular-nums}
.gov .dot{width:7px;height:7px;border-radius:50%;background:#8fe0a3;box-shadow:0 0 0 0 rgba(143,224,163,.7);animation:gDot 2s infinite}
.gov.soon .dot{background:#ffcf66;animation-duration:1s}
@keyframes gDot{70%{box-shadow:0 0 0 7px rgba(143,224,163,0)}100%{box-shadow:0 0 0 0 rgba(143,224,163,0)}}
@keyframes gPulse{0%{box-shadow:0 0 0 0 rgba(243,217,143,.65)}100%{box-shadow:0 0 0 12px rgba(243,217,143,0)}}
/* glass tabs */
nav.tabs{gap:10px;padding:4px 0}
nav.tabs button.gtab{position:relative;overflow:hidden;display:inline-flex;align-items:center;gap:8px;padding:9px 16px 9px 14px;border-radius:16px;font-weight:600;
  color:var(--ink);background:linear-gradient(145deg,color-mix(in srgb,var(--surface) 78%,transparent),color-mix(in srgb,var(--surface) 45%,transparent));
  border:1px solid color-mix(in srgb,var(--line) 70%,#fff);backdrop-filter:blur(12px) saturate(1.4);-webkit-backdrop-filter:blur(12px) saturate(1.4);
  box-shadow:0 1px 0 rgba(255,255,255,.7) inset,0 6px 18px -10px rgba(40,55,30,.45);transition:transform .25s cubic-bezier(.2,.8,.2,1.2),box-shadow .25s,background .25s,color .25s}
nav.tabs button.gtab::before{content:"";position:absolute;top:0;bottom:0;width:40%;left:-60%;background:linear-gradient(100deg,transparent,rgba(255,255,255,.55),transparent);transform:skewX(-20deg);transition:left .6s}
nav.tabs button.gtab:hover{transform:translateY(-3px);box-shadow:0 1px 0 rgba(255,255,255,.7) inset,0 14px 26px -12px rgba(40,55,30,.55);border-color:color-mix(in srgb,var(--olive) 45%,var(--line))}
nav.tabs button.gtab:hover::before{left:120%}
nav.tabs button.gtab:active{transform:translateY(0) scale(.97)}
nav.tabs .gico{display:grid;place-items:center;width:30px;height:30px;border-radius:10px;color:var(--olive);background:color-mix(in srgb,var(--olive) 13%,transparent);transition:transform .35s cubic-bezier(.3,1.6,.5,1),background .25s,color .25s}
nav.tabs .gico svg{width:18px;height:18px}
nav.tabs button.gtab:hover .gico{transform:rotate(-8deg) scale(1.15)}
nav.tabs button.gtab[aria-pressed="true"]{color:#fff;border-color:transparent;background:linear-gradient(135deg,color-mix(in srgb,var(--olive) 92%,#fff),color-mix(in srgb,var(--olive) 80%,#000));
  box-shadow:0 1px 0 rgba(255,255,255,.35) inset,0 10px 24px -8px color-mix(in srgb,var(--olive) 75%,transparent);animation:gBreath 3.2s ease-in-out infinite}
nav.tabs button.gtab[aria-pressed="true"] .gico{color:#fff;background:rgba(255,255,255,.2)}
@keyframes gBreath{50%{box-shadow:0 1px 0 rgba(255,255,255,.35) inset,0 14px 34px -6px color-mix(in srgb,var(--olive) 90%,transparent)}}
.gbadge{min-width:22px;height:22px;padding:0 6px;border-radius:999px;display:inline-grid;place-items:center;font-size:.75rem;font-weight:800;color:#fff;background:linear-gradient(135deg,#e05a47,#a23a2e);box-shadow:0 0 0 0 rgba(224,90,71,.6);animation:gBadge 1.8s ease-out infinite}
@keyframes gBadge{0%{box-shadow:0 0 0 0 rgba(224,90,71,.6)}80%,100%{box-shadow:0 0 0 9px rgba(224,90,71,0)}}
nav.tabs button.has-badge .gico{animation:gNudge 2.8s ease-in-out infinite}
@keyframes gNudge{0%,86%,100%{transform:none}90%{transform:rotate(-12deg)}94%{transform:rotate(10deg)}}
.gripple{position:absolute;border-radius:50%;background:rgba(255,255,255,.55);transform:scale(0);animation:gRip .65s ease-out forwards;pointer-events:none}
@keyframes gRip{to{transform:scale(2.4);opacity:0}}
@media (max-width:640px){.lh-time{font-size:1.35rem}nav.tabs{flex-wrap:nowrap;overflow-x:auto;scrollbar-width:none;padding-bottom:6px}nav.tabs button.gtab{flex:none}}
@media (prefers-reduced-motion:reduce){#liveHdr *,#liveHdr::before,nav.tabs *{animation:none!important;transition:none!important}.lh-strip{overflow-x:auto}}
`;document.head.append(st);
  const hd=document.createElement('div');hd.id='liveHdr';hd.setAttribute('role','banner');
  hd.innerHTML='<div class="lh-in"><div class="lh-top"><div class="lh-clock"></div><div class="lh-next"></div></div><div class="lh-strip"><div class="lh-track"></div></div></div>';
  document.body.prepend(hd);
  hd.querySelector('.lh-clock').append(gIcon('clock'));
  const clk=document.createElement('div');clk.innerHTML='<div class="lh-time"></div><div class="lh-date"></div>';hd.querySelector('.lh-clock').append(clk);
  const tEl=clk.querySelector('.lh-time'),dEl=clk.querySelector('.lh-date'),nEl=hd.querySelector('.lh-next'),track=hd.querySelector('.lh-track');
  const gF=new Intl.DateTimeFormat('ar-EG-u-nu-latn',{weekday:'long',day:'numeric',month:'long',year:'numeric',timeZone:TZ});
  let hF;try{hF=new Intl.DateTimeFormat('ar-SA-u-ca-islamic-umalqura-nu-latn',{day:'numeric',month:'long',year:'numeric',timeZone:TZ})}catch(_){}
  function tickClock(){const now=new Date(),p=new Intl.DateTimeFormat('en-GB',{hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false,timeZone:TZ}).format(now).split(':');
    tEl.innerHTML='<bdi dir="ltr">'+p[0]+':'+p[1]+'<i>:'+p[2]+'</i></bdi>';dEl.innerHTML='<b>'+gF.format(now)+'</b>'+(hF?'<br>'+hF.format(now):'')}
  function govCards(){const items=GOVS.map(([n,la,lo],i)=>{const x=nextPrayer(la,lo,i===0);const soon=x.at-Date.now()<15*60e3;
      const title=GP.map(([k,nm])=>nm+' '+fmtT(x.all[k])).join(' · ');
      return '<div class="gov'+(soon?' soon':'')+'" title="'+n+': '+title+'"><span class="dot"></span><span class="nm">'+n+'</span><span class="pn">'+x.n+'</span><span class="tm">'+fmtT(x.at)+'</span></div>'}).join('');
    track.innerHTML=items+items}
  function tickNext(){const x=nextPrayer(GOVS[0][1],GOVS[0][2],true),now=Date.now(),pc=Math.min(100,Math.max(0,(now-x.prev)/(x.at-x.prev)*100));
    nEl.classList.toggle('soon',x.at-now<15*60e3);
    if(!nEl.firstChild){const r=document.createElement('div');r.className='lh-ring';r.append(gIcon('bell'));nEl.append(r,document.createElement('div'))}
    nEl.firstChild.style.setProperty('--p',pc.toFixed(1));
    nEl.lastChild.innerHTML='<small>الصلاة القادمة في نابلس</small><b>'+x.n+' '+fmtT(x.at)+'</b> · <span class="cd">'+left(x.at-now)+'</span>'}
  let lastMin=-1;
  const loop=()=>{tickClock();tickNext();const m=new Date().getMinutes();if(m!==lastMin){lastMin=m;govCards()}};
  loop();setInterval(loop,1000);
}

return{gIcon,gRipple,liveHeader}})();
