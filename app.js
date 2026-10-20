'use strict';
const $ = id => document.getElementById(id);
const STORE = 'fruity-weapon-review.notes.v1';
const encoder = new TextEncoder(), decoder = new TextDecoder();
let key, settings, catalog, selected, reviews = {}, token = 0, currentURL, timer;
let saving = Promise.resolve(), saveSequence = 0, pendingImport, commentTime = 0;
let persistenceBlocked = false;
let dirty = false;
let editVersion = 0;
const video = $('video');
const bytes = value => Uint8Array.from(atob(value), c => c.charCodeAt(0));
const base64 = value => { let s = ''; for (const n of new Uint8Array(value)) s += String.fromCharCode(n); return btoa(s); };
const time = n => `${Math.floor(n / 60)}:${(n % 60).toFixed(1).padStart(4, '0')}`;
async function get(path) { const r = await fetch(path, {cache:'no-cache'}); if (!r.ok) throw new Error(`Could not load ${path} (${r.status})`); return r; }
async function derive(password, salt) {
  const material = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({name:'PBKDF2',salt:bytes(salt),iterations:settings.iterations,hash:'SHA-256'},material,{name:'AES-GCM',length:256},false,['encrypt','decrypt']);
}
async function decrypt(data, usingKey = key) { const b = new Uint8Array(data); return crypto.subtle.decrypt({name:'AES-GCM',iv:b.slice(0,12)},usingKey,b.slice(12)); }
async function encrypt(data, usingKey = key) { const iv = crypto.getRandomValues(new Uint8Array(12)); const payload = await crypto.subtle.encrypt({name:'AES-GCM',iv},usingKey,data); const out = new Uint8Array(12 + payload.byteLength); out.set(iv); out.set(new Uint8Array(payload),12); return out; }
function review(id = selected?.id) { return reviews[id] || {status:'unreviewed',notes:'',comments:[]}; }
function error(message) { $('footer-status').textContent = message; }
function snapshot() { return {schema:1,project:'fruity-survivors-weapon-review',exportedAt:new Date().toISOString(),captureRevision:catalog.revision,reviews}; }
function queueSave() {
  dirty = true; editVersion++; clearTimeout(timer); $('save-state').textContent = 'Saving…';
  timer = setTimeout(persist,250);
}
function persist() {
  clearTimeout(timer);
  if (!key || !catalog) return saving;
  if (persistenceBlocked) { $('save-state').textContent = 'Export to save'; return saving; }
  const payload = encoder.encode(JSON.stringify(snapshot())), usingKey = key, sequence = ++saveSequence, version = editVersion;
  saving = saving.then(async () => {
    const encrypted = await encrypt(payload,usingKey);
    localStorage.setItem(STORE,base64(encrypted));
    if (sequence === saveSequence && version === editVersion) { $('save-state').textContent = 'Saved locally'; dirty = false; }
  }).catch(() => { $('save-state').textContent = 'Save failed — export JSON'; error('Browser storage is unavailable or full. Export JSON now to keep your notes.'); });
  return saving;
}
function updateReview(patch) {
  if (!selected) return;
  reviews[selected.id] = {...review(), ...patch, updatedAt:new Date().toISOString(), weaponName:selected.name, clipRevision:catalog.revision};
  queueSave(); renderRoster();
}
function renderRoster() {
  const query = $('search').value.trim().toLowerCase(), filter = $('filter').value;
  const container = $('roster'); container.replaceChildren();
  catalog.weapons.forEach((w,i) => {
    const status = review(w.id).status;
    if (!`${w.name} ${w.id} ${w.tags.join(' ')}`.toLowerCase().includes(query) || (filter !== 'all' && status !== filter)) return;
    const b = document.createElement('button'); b.className = 'weapon-button'; b.dataset.status = status;
    b.setAttribute('aria-current',String(selected?.id === w.id)); b.title = `${w.name} · ${status.replaceAll('-',' ')}`;
    const ordinal = document.createElement('span'); ordinal.className='ordinal'; ordinal.textContent=String(i+1).padStart(2,'0');
    const name = document.createElement('span'); name.textContent = w.name;
    const dot = document.createElement('span'); dot.className='dot'; dot.setAttribute('aria-hidden','true');
    b.append(ordinal,name,dot); b.addEventListener('click',()=>select(w.id)); container.append(b);
  });
  if (!container.children.length) { const p=document.createElement('p'); p.className='muted'; p.textContent='No matching weapons.'; container.append(p); }
  const done = catalog.weapons.filter(w=>review(w.id).status!=='unreviewed').length;
  $('progress').textContent = `${done} of ${catalog.weapons.length} reviewed`;
}
function renderComments() {
  const comments=review().comments; $('comments').replaceChildren(); $('comment-count').textContent=comments.length ? `(${comments.length})` : '';
  $('empty-comments').hidden=comments.length>0;
  for (const c of comments) {
    const item=document.createElement('article'); item.className='comment';
    const bar=document.createElement('div'); bar.className='comment-bar';
    const seek=document.createElement('button'); seek.className='time-link'; seek.textContent=time(c.at); seek.addEventListener('click',()=>{ video.pause(); video.currentTime=Math.min(c.at,video.duration||c.at); });
    const remove=document.createElement('button'); remove.className='delete-comment'; remove.textContent='Delete'; remove.setAttribute('aria-label',`Delete comment at ${time(c.at)}`);
    remove.addEventListener('click',()=>{ if (!confirm('Delete this moment note?')) return; updateReview({comments:review().comments.filter(x=>x.id!==c.id)}); renderComments(); });
    const p=document.createElement('p'); p.textContent=c.text; bar.append(seek,remove); item.append(bar,p); $('comments').append(item);
  }
}
async function select(id) {
  const w=catalog.weapons.find(w=>w.id===id); if (!w) return;
  selected=w; const request=++token; video.pause(); video.removeAttribute('src'); video.load();
  $('mobile-current').textContent = `${catalog.weapons.indexOf(w)+1}/${catalog.weapons.length}`;
  $('catalog-panel').classList.remove('is-open'); $('catalog-toggle').setAttribute('aria-expanded','false');
  if (currentURL) URL.revokeObjectURL(currentURL); currentURL=null;
  $('media-message').hidden=false; $('media-message').textContent='Decrypting gameplay preview…';
  $('weapon-name').textContent=w.name; $('weapon-kicker').textContent=`WEAPON ${String(catalog.weapons.indexOf(w)+1).padStart(2,'0')} / ${catalog.weapons.length} · LEVEL ${w.level}`;
  $('weapon-tags').textContent=w.tags.join(' / '); $('notes').value=review().notes; $('status').value=review().status;
  const base=catalog.weapons.find(x=>x.evolves_to===id), evolved=catalog.weapons.find(x=>x.id===w.evolves_to);
  $('relations').textContent=base ? `Evolution of ${base.name}` : evolved ? `Evolves into ${evolved.name}` : 'Standalone weapon';
  $('capture-revision').textContent=`Capture ${catalog.revision.slice(0,8)} · ${w.fps} fps`;
  $('capture-note').textContent='Actual Godot gameplay · maximum weapon level · staged moving targets. Fixed-step footage shows animation timing, not live frame-rate performance.'+(w.staged_kill_triggers>0?' Real enemy deaths are staged to trigger this kill-reactive weapon.':'');
  history.replaceState(null,'',`#${encodeURIComponent(id)}`); renderRoster(); renderComments();
  try {
    const raw=await (await get(w.media)).arrayBuffer(), clear=await decrypt(raw);
    if(request!==token || !key) return;
    currentURL=URL.createObjectURL(new Blob([clear],{type:'video/mp4'})); video.src=currentURL;
    video.playbackRate=Number($('speed').value); $('media-message').hidden=true;
    video.play().catch(()=>{});
  } catch(e) { if(request===token) { $('media-message').textContent='Preview could not load. Select this weapon again to retry.'; error(e.message); } }
}
$('unlock-form').addEventListener('submit',async e=>{
  e.preventDefault(); $('unlock').disabled=true; $('unlock-message').textContent='Opening the gallery…';
  try {
    settings=await (await get('vault.json')).json();
    const candidate=await derive($('password').value,settings.salt);
    let data;
    try { data=await decrypt(await (await get('catalog.bin')).arrayBuffer(),candidate); }
    catch { throw new Error('Incorrect password, or the gallery file is damaged. Try again.'); }
    catalog=JSON.parse(decoder.decode(data)); if(!Array.isArray(catalog.weapons)||!catalog.weapons.length) throw new Error('The gallery is empty.');
    key=candidate; reviews={}; persistenceBlocked=false;
    try { const stored=localStorage.getItem(STORE); if(stored) reviews=validateImport(JSON.parse(decoder.decode(await decrypt(bytes(stored))))).reviews; }
    catch { persistenceBlocked=true; error('Existing notes could not be read. They have not been overwritten. Export this session’s notes before leaving.'); }
    $('password').value=''; $('gate').hidden=true; $('app').hidden=false; $('count').textContent=catalog.weapons.length;
    await select(decodeURIComponent(location.hash.slice(1)) || catalog.weapons[0].id);
    if(!selected) await select(catalog.weapons[0].id);
  } catch(e) { $('unlock-message').textContent=e.message; }
  finally { $('unlock').disabled=false; }
});
$('search').addEventListener('input',renderRoster); $('filter').addEventListener('change',renderRoster);
$('catalog-toggle').addEventListener('click',()=>{ const open=$('catalog-panel').classList.toggle('is-open'); $('catalog-toggle').setAttribute('aria-expanded',String(open)); });
$('fullscreen').addEventListener('click',()=>{ if(video.webkitEnterFullscreen) video.webkitEnterFullscreen(); else video.requestFullscreen?.().catch(()=>error('Use your browser’s video full-screen control.')); });
$('notes').addEventListener('input',()=>updateReview({notes:$('notes').value})); $('status').addEventListener('change',()=>updateReview({status:$('status').value}));
for(const [button,offset] of [['previous',-1],['next',1]]) $(button).addEventListener('click',()=>{ const i=catalog.weapons.indexOf(selected); select(catalog.weapons[(i+offset+catalog.weapons.length)%catalog.weapons.length].id); });
$('speed').addEventListener('change',()=>video.playbackRate=Number($('speed').value));
for(const [button,offset] of [['frame-back',-1],['frame-next',1]]) $(button).addEventListener('click',()=>{ video.pause(); if(Number.isFinite(video.duration)) video.currentTime=Math.max(0,Math.min(video.duration,video.currentTime+offset/selected.fps)); });
video.addEventListener('timeupdate',()=>$('playhead').textContent=time(video.currentTime));
video.addEventListener('error',()=>{ if(video.hasAttribute('src')) { $('media-message').hidden=false; $('media-message').textContent='This browser could not decode the video. Try a current Chrome, Edge, Firefox or Safari.'; } });
$('stamp').addEventListener('click',()=>{ if(!Number.isFinite(video.duration)) return; video.pause(); commentTime=video.currentTime; $('comment-at').textContent=`${selected.name} · ${time(commentTime)}`; $('comment-text').value=''; $('comment-dialog').showModal(); $('comment-text').focus(); });
$('cancel-comment').addEventListener('click',()=>$('comment-dialog').close());
$('comment-form').addEventListener('submit',e=>{ e.preventDefault(); const text=$('comment-text').value.trim(); if(!text) return; updateReview({comments:[...review().comments,{id:crypto.randomUUID(),at:commentTime,text,createdAt:new Date().toISOString()}]}); renderComments(); $('comment-dialog').close(); });
function download(data,name) { const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'})); const a=document.createElement('a'); a.href=url; a.download=name; a.click(); setTimeout(()=>URL.revokeObjectURL(url),1000); }
$('export').addEventListener('click',()=>{ download(snapshot(),`fruity-weapon-reviews-${new Date().toISOString().slice(0,10)}.json`); dirty=false; error('JSON exported. Keep it as a backup or send it back with your feedback.'); });
function validateImport(data) {
  if(data?.schema!==1 || data?.project!=='fruity-survivors-weapon-review' || !data.reviews || typeof data.reviews!=='object' || Array.isArray(data.reviews)) throw new Error('Not a Fruity Survivors weapon review file.');
  const cleaned={}; let skipped=0;
  for(const [id,r] of Object.entries(data.reviews)) {
    if(!catalog.weapons.some(w=>w.id===id)) { skipped++; continue; }
    if(!r || !['unreviewed','needs-work','approved'].includes(r.status) || typeof r.notes!=='string' || r.notes.length>20000 || !Array.isArray(r.comments) || r.comments.length>1000 || typeof r.updatedAt!=='string' || !Number.isFinite(Date.parse(r.updatedAt))) throw new Error(`Invalid notes for ${id}. Nothing imported.`);
    const comments=r.comments.map(c=>{ if(!c || typeof c.id!=='string' || c.id.length>100 || !Number.isFinite(c.at)||c.at<0||c.at>3600||typeof c.text!=='string'||c.text.length>5000) throw new Error(`Invalid moment note for ${id}.`); return {id:c.id,at:c.at,text:c.text,createdAt:typeof c.createdAt==='string'?c.createdAt:r.updatedAt}; });
    cleaned[id]={status:r.status,notes:r.notes,comments,updatedAt:r.updatedAt,weaponName:catalog.weapons.find(w=>w.id===id).name,clipRevision:typeof r.clipRevision==='string'?r.clipRevision:''};
  }
  return {reviews:cleaned,skipped};
}
$('import').addEventListener('click',()=>$('import-file').click());
$('import-file').addEventListener('change',async e=>{
  const file=e.target.files[0]; e.target.value=''; if(!file) return;
  try { if(file.size>5*1024*1024) throw new Error('Review file is larger than 5 MB.'); pendingImport=validateImport(JSON.parse(await file.text())); $('import-summary').textContent=`${Object.keys(pendingImport.reviews).length} weapon reviews found. ${pendingImport.skipped} unknown weapon IDs skipped.`; $('import-dialog').showModal(); }
  catch(e) { error(e.message); }
});
$('cancel-import').addEventListener('click',()=>$('import-dialog').close());
$('confirm-import').addEventListener('click',()=>{ for(const [id,r] of Object.entries(pendingImport.reviews)) if(!reviews[id]||Date.parse(r.updatedAt)>=Date.parse(reviews[id].updatedAt)) reviews[id]=r; $('import-dialog').close(); queueSave(); renderRoster(); $('notes').value=review().notes; $('status').value=review().status; renderComments(); error('Notes merged. Export a fresh JSON backup whenever you finish reviewing.'); });
$('lock').addEventListener('click',async()=>{ await persist(); if(dirty) { error('Your notes are not saved. Export JSON before locking.'); return; } token++; video.pause(); video.removeAttribute('src'); video.load(); if(currentURL) URL.revokeObjectURL(currentURL); currentURL=null; key=null; catalog=null; selected=null; reviews={}; $('notes').value=''; $('comments').replaceChildren(); $('roster').replaceChildren(); $('app').hidden=true; $('gate').hidden=false; $('unlock-message').textContent='Gallery locked. Your saved notes are still here.'; $('password').focus(); });
document.addEventListener('visibilitychange',()=>{ if(document.hidden) { persist(); video.pause(); } });
window.addEventListener('storage',e=>{ if(e.key===STORE && key) error('Notes changed in another tab. Export your current notes before reloading to avoid overwriting them.'); });
window.addEventListener('beforeunload',e=>{ if(dirty) { e.preventDefault(); e.returnValue=''; } });
