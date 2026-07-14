/**
 * Self-contained OTA/settings dashboard page (dark-glass theme, no CDN).
 * Served as a single HTML string so it bundles cleanly and needs no static
 * asset shipping. The install flow uses a stepper + progress bar that treats
 * fetch errors during the restart window as "restarting" and auto-reloads when
 * the new version answers — fixing the "failed to fetch" race.
 */
export const DASHBOARD_HTML = String.raw`<!DOCTYPE html>
<html lang="de">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>FRITZ!Box Presence</title>
<style>
:root{
  --color-bg:#05070d;--color-card:#101725;--color-card-border:#232c3b;
  --color-text:#e8edf6;--color-muted:#9aa6b8;--color-faint:#6b7686;
  --color-accent:#f59e0b;--color-accent-strong:#fbbf24;--color-accent-contrast:#1a1205;
  --color-info:#3b82f6;--color-success:#22c55e;--color-warn:#f0b300;--color-danger:#ef4444;
  --focus-ring:0 0 0 3px rgba(245,158,11,.45);
  --sp-2:8px;--sp-3:12px;--sp-4:16px;--sp-5:24px;--radius:10px;--radius-lg:14px;--radius-pill:999px;
  --shadow-2:0 4px 12px rgba(0,0,0,.35);--shadow-3:0 10px 30px rgba(0,0,0,.45);
  --glass-bg:rgba(10,15,26,.5);--glass-border:rgba(255,255,255,.09);--glass-blur:22px;
  --glass-sheen:linear-gradient(157deg,rgba(255,255,255,.11) 0%,rgba(255,255,255,0) 64%);
}
*{box-sizing:border-box}
body{margin:0;background:
  radial-gradient(1100px 540px at 82% -12%,rgba(245,158,11,.07),transparent 60%),
  radial-gradient(900px 500px at 12% 8%,rgba(59,130,246,.06),transparent 62%),
  linear-gradient(180deg,#070a12 0%,#04060c 100%),var(--color-bg);
  color:var(--color-text);font:14px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;
  min-height:100vh;padding:var(--sp-5);font-variant-numeric:tabular-nums}
.wrap{max-width:720px;margin:0 auto;display:flex;flex-direction:column;gap:var(--sp-4)}
header{display:flex;align-items:center;justify-content:space-between;gap:var(--sp-3);flex-wrap:wrap}
h1{font-size:1.4rem;font-weight:700;letter-spacing:-.01em;margin:0}
.badge{font-size:12px;color:var(--color-accent-contrast);background:linear-gradient(180deg,var(--color-accent-strong),var(--color-accent));
  padding:3px 10px;border-radius:var(--radius-pill);font-weight:700}
.card{background:var(--glass-sheen),var(--glass-bg);border:1px solid var(--glass-border);border-radius:var(--radius-lg);
  backdrop-filter:blur(var(--glass-blur)) saturate(1.4);-webkit-backdrop-filter:blur(var(--glass-blur)) saturate(1.4);
  box-shadow:var(--shadow-2);padding:var(--sp-4);display:flex;flex-direction:column;gap:var(--sp-3)}
.card h2{font-size:1.02rem;font-weight:650;margin:0}
.row{display:flex;align-items:center;justify-content:space-between;gap:var(--sp-3);flex-wrap:wrap}
.muted{color:var(--color-muted)}.faint{color:var(--color-faint);font-size:12px}
.kv{display:grid;grid-template-columns:auto 1fr;gap:4px var(--sp-4);font-size:13px}
.kv b{color:var(--color-muted);font-weight:500}
button{font:inherit;font-weight:600;border-radius:6px;border:1px solid var(--color-card-border);
  background:var(--color-card);color:var(--color-text);padding:var(--sp-2) var(--sp-4);cursor:pointer;min-height:36px;
  transition:border-color .14s,box-shadow .14s,background .14s,transform .05s}
button:hover:not(:disabled){border-color:var(--color-accent)}
button:active:not(:disabled){transform:translateY(1px)}
button:disabled{opacity:.5;cursor:not-allowed}
button.primary{background:linear-gradient(180deg,var(--color-accent-strong),var(--color-accent));color:var(--color-accent-contrast);border-color:transparent}
:focus-visible{outline:none;box-shadow:var(--focus-ring)}
.seg{display:inline-flex;border:1px solid var(--color-card-border);border-radius:var(--radius-pill);overflow:hidden}
.seg button{border:0;border-radius:0;background:transparent;min-height:32px;padding:6px 14px}
.seg button.on{background:linear-gradient(180deg,var(--color-accent-strong),var(--color-accent));color:var(--color-accent-contrast)}
.switch{position:relative;width:46px;height:26px;flex:none}
.switch input{opacity:0;width:0;height:0}
.slider{position:absolute;inset:0;background:var(--color-card-border);border-radius:var(--radius-pill);transition:.2s}
.slider:before{content:"";position:absolute;height:20px;width:20px;left:3px;top:3px;background:#fff;border-radius:50%;transition:.2s}
.switch input:checked+.slider{background:var(--color-success)}
.switch input:checked+.slider:before{transform:translateX(20px)}
.bar{height:8px;border-radius:var(--radius-pill);background:rgba(255,255,255,.08);overflow:hidden;position:relative;display:none}
.bar.show{display:block}
.bar>span{position:absolute;left:0;top:0;bottom:0;width:35%;border-radius:var(--radius-pill);
  background:linear-gradient(90deg,var(--color-accent),var(--color-accent-strong))}
.bar.indet>span{animation:slide 1.2s ease-in-out infinite}
@keyframes slide{0%{left:-35%}100%{left:100%}}
.steps{display:flex;gap:var(--sp-2);font-size:12px;color:var(--color-faint);flex-wrap:wrap}
.steps .s.on{color:var(--color-accent-strong);font-weight:600}
.steps .s.done{color:var(--color-success)}
.status{font-size:13px}
.status.err{color:var(--color-danger)}.status.ok{color:var(--color-success)}
pre{background:#0b0f18;border:1px solid var(--color-card-border);border-radius:var(--radius);padding:var(--sp-3);
  overflow:auto;font-size:12px;margin:0;max-height:280px}
details summary{cursor:pointer;color:var(--color-muted)}
select{font:inherit;background:#090d16;color:var(--color-text);border:1px solid var(--color-card-border);border-radius:6px;min-height:32px;padding:4px 8px}
@media (prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}}
</style>
</head>
<body>
<div class="wrap">
  <header>
    <div style="display:flex;align-items:center;gap:10px">
      <h1 data-t="FRITZ!Box Anwesenheit|FRITZ!Box Presence"></h1>
      <span class="badge" id="ver">…</span>
    </div>
    <div class="seg" id="lang">
      <button data-lang="auto" class="on">AUTO</button><button data-lang="de">DE</button><button data-lang="en">EN</button>
    </div>
  </header>

  <section class="card">
    <h2 data-t="Updates|Updates"></h2>
    <div class="kv">
      <b data-t="Installierte Version|Installed version"></b><span id="otaVer">…</span>
      <b data-t="Image-Version|Image version"></b><span id="coreVer">…</span>
      <b data-t="Neueste Version|Latest version"></b><span id="latestVer">…</span>
    </div>
    <div class="row">
      <span data-t="Modus|Mode"></span>
      <div class="seg" id="mode">
        <button data-mode="auto" data-t="Automatisch|Automatic"></button>
        <button data-mode="manual" data-t="Manuell|Manual"></button>
      </div>
    </div>
    <div class="row">
      <span data-t="Kanal|Channel"></span>
      <div class="seg" id="channel">
        <button data-ch="stable" data-t="Stabil|Stable"></button>
        <button data-ch="experimental" data-t="Experimentell|Experimental"></button>
      </div>
    </div>
    <div class="bar" id="bar"><span></span></div>
    <div class="steps" id="steps" style="display:none">
      <span class="s" data-step="install" data-t="Installieren|Installing"></span>
      <span class="s" data-step="restart" data-t="Neustart läuft…|Restarting…"></span>
      <span class="s" data-step="done" data-t="Fertig|Done"></span>
    </div>
    <div class="status" id="otaStatus"></div>
    <div class="row">
      <button id="checkBtn" data-t="Jetzt prüfen|Check now"></button>
      <button id="updateBtn" class="primary" style="display:none" data-t="Jetzt aktualisieren|Update now"></button>
    </div>
    <div class="faint" id="expHint" style="display:none" data-t="Experimentell liefert rollierende Vorabversionen — nur zum Testen.|Experimental delivers rolling prereleases — for testing only."></div>
  </section>

  <section class="card">
    <h2 data-t="Datenschutz|Privacy"></h2>
    <div class="row">
      <span data-t="Anonyme Nutzungsstatistik senden|Send anonymous usage statistics"></span>
      <label class="switch"><input type="checkbox" id="analytics"><span class="slider"></span></label>
    </div>
    <p class="faint" data-t="An = pseudonyme technische Metadaten (Versionen, Architektur, Firmware, Sprache). Niemals Namen, Räume, Geräte, Messwerte, Tokens oder deine SGTIN.|On = pseudonymous technical metadata (versions, architecture, firmware, language). Never names, rooms, devices, measurements, tokens or your SGTIN."></p>
    <details>
      <summary data-t="Was wird gesendet?|What is sent?"></summary>
      <pre id="preview">…</pre>
    </details>
  </section>
</div>
<script>
const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
let lang=localStorage.getItem('lang')||'auto';
function eff(){return lang==='auto'?((navigator.language||'de').toLowerCase().startsWith('de')?'de':'en'):lang;}
function T(pair){const [de,en]=pair.split('|');return eff()==='de'?de:en;}
function applyI18n(){
  document.documentElement.lang=eff();
  $$('[data-t]').forEach(el=>el.textContent=T(el.getAttribute('data-t')));
  $$('#lang button').forEach(b=>b.classList.toggle('on',b.dataset.lang===lang));
}
$$('#lang button').forEach(b=>b.onclick=()=>{lang=b.dataset.lang;localStorage.setItem('lang',lang);applyI18n();});

async function api(path,opts){const r=await fetch(path,opts);if(!r.ok&&r.status!==204)throw new Error('HTTP '+r.status);return r.status===204?null:r.json();}
let installing=false;

function renderStatus(s){
  $('#ver').textContent='v'+(s.otaVersion||'?');
  $('#otaVer').textContent=s.otaVersion+(s.otaActive?' (OTA)':' (Image)');
  $('#coreVer').textContent=s.coreVersion;
  $('#latestVer').textContent=s.latestVersion||'—';
  $$('#mode button').forEach(b=>b.classList.toggle('on',b.dataset.mode===s.mode));
  $$('#channel button').forEach(b=>b.classList.toggle('on',b.dataset.ch===s.channel));
  $('#expHint').style.display=s.channel==='experimental'?'block':'none';
  const st=$('#otaStatus');
  const ub=$('#updateBtn');
  if(installing)return;
  if(s.requiresCore){ub.style.display='none';st.className='status';st.textContent=T('Kern-Update nötig — neue .tar.gz über HCUweb installieren.|Core update required — install the new .tar.gz via HCUweb.');}
  else if(s.updateAvailable){ub.style.display='';st.className='status ok';st.textContent=T('Update verfügbar: v'+s.latestVersion+'|Update available: v'+s.latestVersion);}
  else {ub.style.display='none';st.className='status';st.textContent=s.lastCheckedAt?T('Aktuell.|Up to date.'):'';}
  if(s.lastError){st.className='status err';st.textContent=T('Fehler bei der Prüfung.|Update check failed.');}
}

async function load(){try{renderStatus(await api('/api/ota/status'));}catch(e){}}
async function loadCfg(){try{const c=await api('/api/config');$('#analytics').checked=!!c.analytics.enabled;}catch(e){}}
async function loadPreview(){try{$('#preview').textContent=JSON.stringify(await api('/api/analytics/preview'),null,2);}catch(e){$('#preview').textContent='—';}}

$('#checkBtn').onclick=async()=>{const b=$('#checkBtn');b.disabled=true;$('#otaStatus').textContent=T('Prüfe…|Checking…');try{renderStatus(await api('/api/ota/check',{method:'POST'}));}catch(e){}b.disabled=false;loadPreview();};

$$('#mode button').forEach(b=>b.onclick=async()=>{await api('/api/config',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({updatesMode:b.dataset.mode})});load();});
$$('#channel button').forEach(b=>b.onclick=async()=>{await api('/api/config',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({updatesChannel:b.dataset.ch})});load();});
$('#analytics').onchange=async e=>{await api('/api/config',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({analyticsEnabled:e.target.checked})});loadPreview();};

function step(name){['install','restart','done'].forEach(n=>{const el=document.querySelector('.s[data-step="'+n+'"]');el.classList.remove('on','done');});
  const order=['install','restart','done'];const i=order.indexOf(name);
  order.forEach((n,j)=>{const el=document.querySelector('.s[data-step="'+n+'"]');if(j<i)el.classList.add('done');else if(j===i)el.classList.add('on');});}

async function pollUntilBack(){
  const deadline=Date.now()+120000;
  // wait a moment for the process to actually exit first
  await new Promise(r=>setTimeout(r,2500));
  while(Date.now()<deadline){
    try{const s=await api('/api/state');if(s&&s.ok){step('done');$('#otaStatus').className='status ok';$('#otaStatus').textContent=T('Fertig — lade neu…|Done — reloading…');setTimeout(()=>location.reload(),1200);return;}}
    catch(e){/* server down during restart — expected */}
    await new Promise(r=>setTimeout(r,2000));
  }
  $('#otaStatus').className='status';$('#otaStatus').textContent=T('Dauert länger als erwartet — bitte Seite neu laden.|Taking longer than expected — please reload the page.');
}

$('#updateBtn').onclick=async()=>{
  if(installing)return;installing=true;
  $('#updateBtn').disabled=true;$('#checkBtn').disabled=true;
  $('#steps').style.display='flex';$('#bar').classList.add('show','indet');
  step('install');$('#otaStatus').className='status';$('#otaStatus').textContent=T('Installiere…|Installing…');
  try{
    const res=await api('/api/ota/install',{method:'POST'});
    if(res&&res.code&&res.code!=='installed'){
      installing=false;$('#updateBtn').disabled=false;$('#checkBtn').disabled=false;
      $('#bar').classList.remove('show','indet');$('#steps').style.display='none';
      $('#otaStatus').className='status err';$('#otaStatus').textContent=T('Installation fehlgeschlagen: ','Install failed: ')+res.code;return;
    }
    // installed (or the server exited before responding) -> restart phase
    step('restart');$('#otaStatus').textContent=T('Neustart läuft…|Restarting…');
    await pollUntilBack();
  }catch(e){
    // fetch failed -> server likely restarting already
    step('restart');$('#otaStatus').textContent=T('Neustart läuft…|Restarting…');
    await pollUntilBack();
  }
};

applyI18n();load();loadCfg();loadPreview();
setInterval(()=>{if(!installing)load();},15000);
</script>
</body>
</html>`;
