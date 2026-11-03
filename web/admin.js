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
  const tabs=[...(window.extAuth?[['accounts','حسابات التطبيق']]:[]),['apps','طلبات التسجيل'],['today','الحضور اليومي'],['monthly','التقارير الشهرية'],['messages','المراسلات'],['leaves','الإجازات'],['month','إحصاء الحضور الشهري'],['lessons','الدروس'],['reports','بلاغات المساجد'],['mosques','المساجد والإعدادات'],['staff','الأئمة والمؤذنون']];
  $('#main').replaceChildren(h('div',{style:'display:grid;gap:16px'},
    h('nav',{class:'tabs'},dyn('adminTabs',()=>tabs.map(([k,l])=>{const n=k==='apps'?S.apps.filter(a=>a.status==='pending').length:k==='monthly'?unreviewedCount():k==='messages'?S.threads.filter(adminUnread).length:k==='leaves'?S.staff.filter(s=>s.uid).reduce((n,s)=>n+leavesOf(s.uid).filter(l=>!l.dec&&!l.cancelled).length,0):0;
      return h('button',{'aria-pressed':String(S.adminTab===k),onclick:()=>{S.adminTab=k;renderAdmin()}},l,n?h('span',{class:'chip absent',style:'margin-inline-start:6px;padding:0 7px'},n):null)}))),
    {accounts:adminAccounts,apps:adminApps,leaves:adminLeaves,messages:adminMessages,monthly:adminMonthly,today:adminToday,month:adminMonth,lessons:adminLessons,reports:adminReports,mosques:adminMosques,staff:adminStaff}[S.adminTab]()));
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
