// === CONFIG ===
const PATH_VOCAB    = 'data/vocabulary.csv';
const PATH_BROLLO   = 'data/brollo.csv';
const PATH_EXAMPLES = 'data/examples.csv'; 

if (window['pdfjsLib']) {
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
}

// === STATE ===
let DF=[], BROLLO=[], EXAMPLES=[];
let DF_ID_MAP = new Map();
let CAR_CHARS = new Set(), SIMP_CHARS = new Set();
let ROM_MAP = new Map();
let COMBO_ALL = [], EX_BY_TERM = new Map();

let CURRENT_TEXT = '';
let BROWSE_MODE = true, BLOCK_SIZE = 1200, BLOCK_IDX = 0;

// PDF: OCR per pagina con cache
const PDF = { doc:null, url:null, numPages:0, page:1, cache:new Map(), isActive:false };

// === UTILS ===
const byLenDesc = (a,b)=> b.length - a.length;
const uniq = (arr)=> Array.from(new Set(arr));
const safeStr = (x)=> (x==null? '' : String(x));
const parseJSONSafe = (s)=> { try{return JSON.parse(s);}catch(_){return null;} };
const isBracketedCar = (s)=> /\[/.test(safeStr(s));
function parseCSV(url){
  return new Promise((resolve, reject)=>{
    Papa.parse(url,{download:true, header:true, dynamicTyping:false, skipEmptyLines:true,
      complete: r=>resolve(r.data), error: err=>reject(err)});
  });
}

// === PREP ===
function buildData(){
  CAR_CHARS = new Set( DF.map(r=>safeStr(r['chinese_id.car'])).filter(Boolean) );
  SIMP_CHARS = new Set( DF.map(r=>safeStr(r['chinese_id.simplified_chinese'])).filter(Boolean) );
  ROM_MAP = new Map(); DF_ID_MAP = new Map();
  for(const r of DF){
    const car=safeStr(r['chinese_id.car']), rom=safeStr(r['rom_id.rom']), id=safeStr(r['id']);
    if(car) ROM_MAP.set(car, rom);
    if(id)  DF_ID_MAP.set(id, r);
  }
  const cb=[], ce=[];
  for(const r of BROLLO){
    const g=safeStr(r['glosse_cinesi']).trim(); if(!g) continue;
    for(const t of g.split(/\s+/)){ if(t && t.length>=2) cb.push(t); }
  }
  for(const e of (EXAMPLES||[])){
    const term=safeStr(e['examples']).trim(); if(!term || term.length<2) continue;
    ce.push(term);
    if(!EX_BY_TERM.has(term)) EX_BY_TERM.set(term, []);
    EX_BY_TERM.get(term).push(e);
  }
  COMBO_ALL = uniq([...cb, ...ce]).sort(byLenDesc);
}

const useRom    = ()=> document.getElementById('romToggle').checked;
const useCombo  = ()=> document.getElementById('comboToggle').checked;
const getBrowse = ()=> document.getElementById('browseToggle').checked;
const romForString = (s)=> [...s].map(ch => ROM_MAP.get(ch) ?? ch).join(' ');

function currentSlice(){
  if(!BROWSE_MODE) return CURRENT_TEXT;
  const start = BLOCK_IDX * BLOCK_SIZE;
  return CURRENT_TEXT.slice(start, start + BLOCK_SIZE);
}
function updateNavBar(){
  const info= document.getElementById('navInfo');
  const prev= document.getElementById('navPrev');
  const next= document.getElementById('navNext');
  if(PDF.isActive){
    info.textContent = `Pagina ${PDF.page} / ${PDF.numPages}`;
    prev.disabled = (PDF.page<=1); next.disabled = (PDF.page>=PDF.numPages);
  }else{
    BROWSE_MODE = getBrowse();
    if(BROWSE_MODE){
      const total = Math.max(1, Math.ceil(CURRENT_TEXT.length / BLOCK_SIZE));
      info.textContent = `Blocco ${Math.min(BLOCK_IDX+1,total)} / ${total}`;
      prev.disabled = (BLOCK_IDX<=0); next.disabled = (BLOCK_IDX>=total-1);
    }else{
      info.textContent = '—'; prev.disabled = next.disabled = true;
    }
  }
}

function renderHighlighted(){
  const container = document.getElementById('text');
  container.textContent=''; document.getElementById('details').innerHTML='';
  if(!CURRENT_TEXT){ container.innerHTML='<p class="muted">Carica un file per iniziare.</p>'; updateNavBar(); return; }

  BROWSE_MODE = getBrowse();
  const frag = document.createDocumentFragment();
  const text = currentSlice();
  let i=0;

  while(i<text.length){
    let matched=null;
    if(useCombo()){
      for(const combo of COMBO_ALL){ if(combo.length <= (text.length - i) && text.substr(i, combo.length) === combo){ matched=combo; break; } }
    }
    if(matched){
      const s=document.createElement('span');
      s.className='c-combo'; s.dataset.type='combo'; s.dataset.data=matched;
      s.textContent = useRom()? romForString(matched) : matched;
      frag.appendChild(s); i+=matched.length; continue;
    }
    const ch=text[i];
    const display = useRom() && ROM_MAP.has(ch) ? ROM_MAP.get(ch) : ch;
    const s=document.createElement('span');
    if(CAR_CHARS.has(ch)){ s.className='c-car'; s.dataset.type='char'; s.dataset.data=ch; }
    else if(SIMP_CHARS.has(ch)){ s.className='c-simp'; s.dataset.type='simp'; s.dataset.data=ch; }
    else { s.className='c-missing'; }
    s.textContent=display; frag.appendChild(s); i+=1;
  }
  container.appendChild(frag);
  updateNavBar();
}

function focusDetails(){
  if(getBrowse()) return; // affiancato
  const top = document.getElementById('appRoot').offsetTop;
  window.scrollTo({ top, behavior:'smooth' });
  const side = document.getElementById('sidebar'); side.scrollTop = 0;
}

// === DETTAGLI ===
function collectVariantsAndSynonyms(hits){
  const variants = new Set(); const synIds = new Set();
  for(const b of hits){
    const v = parseJSONSafe(safeStr(b['variants']));
    if(Array.isArray(v)) for(const it of v){ const val=it?.chinese_chinese_id?.related_chinese_id?.car; if(val) variants.add(String(val)); }
    const rel = parseJSONSafe(safeStr(b['related_words_mentioned']));
    if(Array.isArray(rel)) for(const it of rel){ const id=it?.chinese_rom_chinese_rom_id?.chinese_rom_id?.id; if(id!=null) synIds.add(String(id)); }
  }
  const syn = [];
  for(const id of synIds){ const row = DF_ID_MAP.get(String(id)); if(row){ const c = safeStr(row['chinese_id.car']); if(c) syn.push({char:c, id:String(id)}); } }
  return { variants:[...variants], synonyms:uniq(syn.map(s=>JSON.stringify(s))).map(s=>JSON.parse(s)) };
}
function charHeader(r){
  const carRaw = safeStr(r['chinese_id.car']);
  const simp   = safeStr(r['chinese_id.simplified_chinese']);
  const link   = safeStr(r['chinese_id.link']) || safeStr(r['chinese_id.link_nuovo']);
  const display = isBracketedCar(carRaw) && simp ? `${simp}*` : safeStr(r['chinese_id.car']);
  const linkHtml = (isBracketedCar(carRaw) && link) ? ` <a href="${link}" target="_blank" rel="noopener">[link]</a>` : '';
  return `${display}${linkHtml}`;
}
const bubblesHTML = (list)=> `<div class="bubbles">${list.map(x=>`<span class="bubble syn-link" data-syn="${x.char}">${x.char}</span>`).join('')}</div>`;

function renderCharDetails(char, isSimplified){
  const details = document.getElementById('details'); details.innerHTML='';
  const recs = DF.filter(r => safeStr(r[ isSimplified ? 'chinese_id.simplified_chinese' : 'chinese_id.car' ]) === char);
  if(!recs.length){ details.innerHTML = `<div class="card"><strong>Nessun dato per:</strong> ${char}</div>`; focusDetails(); return; }

  const title = document.createElement('div'); title.innerHTML = `<h3 style="margin:0 0 8px">Carattere: ${char}</h3>`; details.appendChild(title);

  for(const r of recs){
    const card=document.createElement('div'); card.className='card wraptext';
    const rom=safeStr(r['rom_id.rom']), def=safeStr(r['english_definition']);
    let inner = `<h4>→ ${charHeader(r)}</h4>`;
    inner += `<div class="kv"><span class="pill">Rom</span> ${rom || '<span class="muted">/</span>'}</div>`;
    inner += `<div class="kv" style="margin-top:6px"><span class="pill">Modern definition</span> ${def || '<span class="muted">/</span>'}</div>`;

    const hits = BROLLO.filter(b => safeStr(b['word.id']) === safeStr(r['id']));
    const {variants, synonyms} = collectVariantsAndSynonyms(hits);
    if(variants.length) inner += `<div class="kv" style="margin-top:6px"><span class="pill">Variants</span> ${variants.join(', ')}</div>`;
    if(synonyms.length) inner += `<div class="kv" style="margin-top:6px"><span class="pill">Synonyms</span> ${bubblesHTML(synonyms)}</div>`;

    if(hits.length){
      inner += '<div class="hr"></div>';
      for(const b of hits){
        const p=parseInt(b['page']), l=parseInt(b['line']), typ=safeStr(b['typology']);
        const latin=safeStr(b['latin_definition']); const arg=safeStr(b['argomento'])||'/'; const gloss=safeStr(b['glosse_cinesi'])||'/';
        inner += `<div style="margin:10px 0">
          <div style="font-weight:600;margin-bottom:6px">Rinuccini (${typ}, ${isNaN(p)?'?':p},${isNaN(l)?'?':l})</div>
          <div class="muted wraptext">${latin}</div>
          <div class="muted" style="margin-top:6px">Tags: ${arg}</div>
          <div class="muted">Glosses: ${gloss}</div>
        </div>`;
      }
    }
    card.innerHTML = inner; details.appendChild(card);
  }
  focusDetails();
}

// Appende scheda sinonimo (giallo soft)
function toggleSynonymDetails(char){
    const details = document.getElementById('details');
    const existing = details.querySelector(`.card--syn[data-syn="${CSS.escape(char)}"]`);
    if (existing) { existing.remove(); return; } // toggle: se c'è, la chiudo
  
    // altrimenti creo la scheda come prima
    const recs = DF.filter(r =>
      String(r['chinese_id.car']||'')===char ||
      String(r['chinese_id.simplified_chinese']||'')===char
    );
    if(!recs.length){
      const c=document.createElement('div'); c.className='card card--syn'; c.dataset.syn=char;
      c.className='card card--syn wraptext';
      c.textContent=`Nessun dato per: ${char}`; details.appendChild(c); return;
    }
    for(const r of recs){
      const card=document.createElement('div'); card.className='card card--syn wraptext'; card.dataset.syn=char;
      const rom=String(r['rom_id.rom']||''), def=String(r['english_definition']||'');
      // header con gestione simplified/link come nelle altre schede
      const carRaw=String(r['chinese_id.car']||'');
      const simp=String(r['chinese_id.simplified_chinese']||'');
      const link=String(r['chinese_id.link']||r['chinese_id.link_nuovo']||'');
      const display = /\[/.test(carRaw) && simp ? `${simp}*` : carRaw;
      const linkHtml = (/\[/.test(carRaw) && link) ? ` <a href="${link}" target="_blank" rel="noopener">[link]</a>` : '';
      let inner = `<h4>Sinonimo: ${display}${linkHtml}</h4>`;
      inner += `<div class="kv"><span class="pill">Rom</span> ${rom || '<span class="muted">/</span>'}</div>`;
      inner += `<div class="kv" style="margin-top:6px"><span class="pill">Modern definition</span> ${def || '<span class="muted">/</span>'}</div>`;
  
      const hits = BROLLO.filter(b => String(b['word.id']||'') === String(r['id']||''));
      if(hits.length){
        inner += '<div class="hr"></div>';
        inner += hits.map(b=>{
          const p=parseInt(b['page']), l=parseInt(b['line']), typ=String(b['typology']||'');
          const latin=String(b['latin_definition']||''); const arg=String(b['argomento']||'/'); const gloss=String(b['glosse_cinesi']||'/');
          return `<div style="margin:10px 0">
            <div style="font-weight:600;margin-bottom:6px">Rinuccini (${typ}, ${isNaN(p)?'?':p},${isNaN(l)?'?':l})</div>
            <div class="muted wraptext">${latin}</div>
            <div class="muted" style="margin-top:6px">Tags: ${arg}</div>
            <div class="muted">Glosses: ${gloss}</div>
          </div>`;
        }).join('');
      }
      card.innerHTML = inner; details.appendChild(card);
    }
  focusDetails();
}

// OUTER DICTIONARIES per EXAMPLES
const DICT_MAP = {
  D:      { name:'HanziHero', url:'https://www.hanzihero.com/', sep:'=' },
  CEDICT: { name:'CC-EDICT',  url:'https://www.mdbg.net/chinese/dictionary?page=cedict', sep:'=' },
  Zd:     { name:'Zdic',      url:'https://www.zdic.net/', sep:':' }
};
function stripOuterParens(s){ let t=s.trim(); if((t.startsWith('(') && t.endsWith(')')) || (t.startsWith('（') && t.endsWith('）'))) t=t.slice(1,-1).trim(); return t; }
function splitProv(raw){ return raw.split(/\s*;\s*/).map(x=>x.trim()).filter(Boolean); }
function parseProvItem(item){ const m=item.match(/^(D|CEDICT|Zd)\s*(.*)$/); if(!m) return null; const tag=m[1]; let text=m[2].trim(); text=stripOuterParens(text); return {tag,text}; }
function renderOuterDictionaries(rows){
  const lines=[];
  for(const e of rows){ const prov=safeStr(e['provenienza']); if(!prov) continue;
    for(const chunk of splitProv(prov)){ const p=parseProvItem(chunk); if(!p) continue; const meta=DICT_MAP[p.tag]; if(!meta) continue;
      lines.push(`<div class="wraptext"><a class="dict-btn" href="${meta.url}" target="_blank" rel="noopener">${meta.name}</a> ${meta.sep} ${p.text}</div>`);
    }
  }
  if(!lines.length) return '';
  return `<div class="outer-list"><strong>Outer dictionaries:</strong></div>` + lines.join('');
}

function renderComboDetails(combo){
  const details = document.getElementById('details'); details.innerHTML='';
  const host = document.getElementById('comboSwitchHost'); host.innerHTML='';

  const sw=document.createElement('label'); sw.className='toggle';
  sw.innerHTML=`<input type="checkbox" id="charsToggle"/><span class="slider"></span><span class="label">Mostra schede caratteri</span>`;
  host.appendChild(sw);

  const exRows = EX_BY_TERM.get(combo) || [];
  for(const e of exRows){ const lat=safeStr(e['latin_definition_2']); if(lat){ const c=document.createElement('div'); c.className='card'; c.innerHTML=`<div class="wraptext">${lat}</div>`; details.appendChild(c); } }
  if(exRows.length){ const ex=document.createElement('div'); ex.className='card'; ex.innerHTML = `<div><span class="pill">Rom</span> ${romForString(combo)}</div>` + renderOuterDictionaries(exRows); details.appendChild(ex); }

  const glosse = BROLLO.filter(r => safeStr(r['glosse_cinesi']).includes(combo));
  const br=document.createElement('div'); br.className='card';
  br.innerHTML = glosse.length
    ? `<h4>Glosse (Brollo)</h4><ul style="padding-left:18px;margin:0">${glosse.map(g=>`<li style="margin:6px 0">${safeStr(g['glosse_cinesi'])}</li>`).join('')}</ul>`
    : `<h4>Glosse (Brollo)</h4><div class="muted">Nessuna glossa trovata per: ${combo}</div>`;
  details.appendChild(br);

  const panel=document.createElement('div'); panel.id='charsPanel'; details.appendChild(panel);
  document.getElementById('charsToggle').addEventListener('change', e=>{
    if(e.target.checked) renderComboCharCards(combo); else panel.innerHTML='';
  });
  focusDetails();
}

function renderComboCharCards(combo){
  const panel = document.getElementById('charsPanel'); panel.innerHTML='';
  for(const ch of combo){
    const recs = DF.filter(r => safeStr(r['chinese_id.car'])===ch || safeStr(r['chinese_id.simplified_chinese'])===ch);
    if(!recs.length){ const empty=document.createElement('div'); empty.className='card card--syn'; empty.innerHTML=`<div class="muted">Nessun dato per: ${ch}</div>`; panel.appendChild(empty); continue; }
    for(const r of recs){
      const c=document.createElement('div'); c.className='card card--syn wraptext';  /* gialle anche qui */
      const rom=safeStr(r['rom_id.rom']), def=safeStr(r['english_definition']);
      const hits = BROLLO.filter(b => safeStr(b['word.id']) === safeStr(r['id']));
      const { synonyms } = collectVariantsAndSynonyms(hits);
      const synHtml = synonyms.length ? `<div style="margin-top:6px"><span class="pill">Synonyms</span> ${bubblesHTML(synonyms)}</div>` : '';
      c.innerHTML = `<h4>${charHeader(r)}</h4>
        <div><span class="pill">Rom</span> ${rom || '<span class="muted">/</span>'}</div>
        <div style="margin-top:6px"><span class="pill">Modern definition</span> ${def || '<span class="muted">/</span>'}</div>
        ${synHtml}`;
      panel.appendChild(c);
    }
  }
}

// === EVENTS ===
document.getElementById('text').addEventListener('click', (e)=>{
  const el=e.target, t=el.dataset?.type; if(!t) return;
  if(t==='combo') renderComboDetails(el.dataset.data);
  else if(t==='char') renderCharDetails(el.dataset.data, false);
  else if(t==='simp') renderCharDetails(el.dataset.data, true);
});
document.getElementById('details').addEventListener('click', (e)=>{
    const el=e.target;
    if(el.classList.contains('syn-link') || el.classList.contains('bubble')){
      const ch=el.dataset.syn; if(ch) toggleSynonymDetails(ch);
    }
  });
document.getElementById('romToggle').addEventListener('change', renderHighlighted);
document.getElementById('comboToggle').addEventListener('change', renderHighlighted);
document.getElementById('browseToggle').addEventListener('change', ()=>{ BLOCK_IDX=0; renderHighlighted(); });

// NAV (PDF o blocchi testo)
document.getElementById('navPrev').addEventListener('click', async ()=>{
  if(PDF.isActive){ if(PDF.page>1){ PDF.page--; await loadPdfPage(PDF.page); } }
  else if(getBrowse()){ if(BLOCK_IDX>0){ BLOCK_IDX--; renderHighlighted(); } }
});
document.getElementById('navNext').addEventListener('click', async ()=>{
  if(PDF.isActive){ if(PDF.page<PDF.numPages){ PDF.page++; await loadPdfPage(PDF.page); } }
  else if(getBrowse()){
    const maxIdx = Math.max(0, Math.ceil(CURRENT_TEXT.length/BLOCK_SIZE)-1);
    if(BLOCK_IDX<maxIdx){ BLOCK_IDX++; renderHighlighted(); }
  }
});

// Drag & Drop + input (fix doppia apertura)
const dz = document.getElementById('dropzone');
const fi = document.getElementById('fileInput');
const dzBtn = dz.querySelector('.dz-btn');

dz.addEventListener('click', (e)=>{ e.preventDefault(); e.stopPropagation(); fi.click(); });
dzBtn.addEventListener('click', (e)=>{ e.preventDefault(); e.stopPropagation(); fi.click(); });

dz.addEventListener('dragover', e=>{ e.preventDefault(); dz.classList.add('dragover'); });
dz.addEventListener('dragleave', ()=> dz.classList.remove('dragover'));
dz.addEventListener('drop', async (e)=>{ e.preventDefault(); dz.classList.remove('dragover'); if(!e.dataTransfer.files?.length) return; await handleFile(e.dataTransfer.files[0]); fi.value=''; });

fi.addEventListener('click', (e)=>{ e.stopPropagation(); }); // evita bubbling che potrebbe riaprire
fi.addEventListener('change', async (e)=>{ const f=e.target.files?.[0]; if(f) { await handleFile(f); fi.value=''; } });

async function handleFile(f){
  const status = document.getElementById('status');
  if(f.type==='application/pdf' || f.name.toLowerCase().endsWith('.pdf')){
    if(!window['pdfjsLib'] || !window['Tesseract']){ alert('OCR PDF non disponibile.'); return; }
    const url = URL.createObjectURL(f);
    PDF.doc = await pdfjsLib.getDocument({url}).promise;
    PDF.url = url; PDF.numPages = PDF.doc.numPages; PDF.page=1; PDF.cache=new Map(); PDF.isActive=true;
    await loadPdfPage(PDF.page);
  }else{
    PDF.isActive=false; CURRENT_TEXT=await f.text(); BLOCK_IDX=0; renderHighlighted();
    status.textContent='';
  }
}

async function loadPdfPage(p){
  const info = document.getElementById('status');
  if(PDF.cache.has(p)){ CURRENT_TEXT = PDF.cache.get(p); BLOCK_IDX=0; renderHighlighted(); info.textContent=''; return; }
  info.textContent = `OCR pagina ${p}/${PDF.numPages}…`;
  const page = await PDF.doc.getPage(p);
  const viewport = page.getViewport({scale:2});
  const canvas = document.createElement('canvas'); const ctx=canvas.getContext('2d');
  canvas.width = viewport.width; canvas.height = viewport.height;
  await page.render({canvasContext:ctx, viewport}).promise;
  let textOut=''; try{ const res=await Tesseract.recognize(canvas,'chi_sim+chi_tra+eng'); textOut=(res.data?.text||'').trim(); }catch(err){ console.warn('OCR error',err); }
  PDF.cache.set(p, textOut); CURRENT_TEXT=textOut; BLOCK_IDX=0; renderHighlighted(); info.textContent='';
}

// === BOOT ===
(async function boot(){
  try{
    const results = await Promise.allSettled([
      parseCSV(PATH_VOCAB),
      parseCSV(PATH_BROLLO),
      parseCSV(PATH_EXAMPLES)
    ]);
    DF       = results[0].status==='fulfilled'? results[0].value : [];
    BROLLO   = results[1].status==='fulfilled'? results[1].value : [];
    EXAMPLES = results[2].status==='fulfilled'? results[2].value : [];
    buildData();
  }catch(err){
    console.error('Errore CSV', err);
    alert('Caricamento CSV fallito. Controlla vocabulary.csv / brollo.csv / examples.csv.');
  }
  renderHighlighted();
  updateNavBar();
})();
