const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const IGNORE = new Set(['.git','node_modules','dist','build','out','vendor','__pycache__','.next','.cache','coverage','.venv','venv']);
const TEXT_EXT = new Set(['.js','.jsx','.ts','.tsx','.json','.html','.css','.scss','.md','.txt','.py','.rb','.php','.java','.kt','.cs','.go','.rs','.toml','.yml','.yaml','.xml','.sql','.env','.ini','.conf','.sh','.ps1','.vue','.svelte','.pgn']);
const LANG = {
  '.js':'JavaScript','.jsx':'JavaScript','.ts':'TypeScript','.tsx':'TypeScript','.py':'Python','.cs':'C#','.java':'Java','.kt':'Kotlin','.go':'Go','.rs':'Rust','.php':'PHP','.rb':'Ruby','.html':'HTML','.css':'CSS','.scss':'SCSS','.vue':'Vue','.svelte':'Svelte','.sql':'SQL'
};
const SECRET_PATTERNS = [
  ['Private key', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/i],
  ['AWS access key', /AKIA[0-9A-Z]{16}/],
  ['Generic secret assignment', /\b(?:api[_-]?key|secret|access[_-]?token|auth[_-]?token)\b\s*[:=]\s*["'][^"']{8,}["']/i]
];
const REALITY_PATTERNS = [
  ['TODO', /\bTODO\b/i], ['FIXME', /\bFIXME\b/i], ['Mock', /\bmock(?:ed|ing)?\b/i],
  ['Placeholder', /\bplaceholder\b/i], ['Lorem ipsum', /lorem\s+ipsum/i], ['Example endpoint', /example\.com/i], ['Localhost dependency', /localhost:\d+/i]
];

function safeRead(file) {
  try {
    const stat = fs.statSync(file);
    if (stat.size > 2 * 1024 * 1024) return null;
    const ext = path.extname(file).toLowerCase();
    const base = path.basename(file).toLowerCase();
    if (!TEXT_EXT.has(ext) && !['dockerfile','makefile','.env','.env.example'].includes(base)) return null;
    return fs.readFileSync(file, 'utf8');
  } catch { return null; }
}

function walk(root, maxFiles=12000) {
  const files=[]; let truncated=false;
  function visit(dir) {
    if (files.length >= maxFiles) { truncated=true; return; }
    let entries=[]; try { entries=fs.readdirSync(dir,{withFileTypes:true}); } catch { return; }
    for (const e of entries) {
      if (files.length >= maxFiles) { truncated=true; break; }
      if (IGNORE.has(e.name)) continue;
      const full=path.join(dir,e.name);
      if (e.isDirectory()) visit(full); else if (e.isFile()) files.push(full);
    }
  }
  visit(root); return {files,truncated};
}

function isBenignPlaceholder(line) {
  return /::placeholder/i.test(line) || /\bplaceholder\s*=\s*["']/i.test(line);
}

function parseDependencies(root) {
  const deps=[];
  const pkg=path.join(root,'package.json');
  if (fs.existsSync(pkg)) {
    try {
      const j=JSON.parse(fs.readFileSync(pkg,'utf8'));
      for (const [name,version] of Object.entries({...j.dependencies,...j.devDependencies})) deps.push({ecosystem:'npm',name,version});
    } catch {}
  }
  const req=path.join(root,'requirements.txt');
  if (fs.existsSync(req)) {
    try {
      for (const line of fs.readFileSync(req,'utf8').split(/\r?\n/)) {
        const s=line.trim(); if (!s || s.startsWith('#')) continue;
        const m=s.match(/^([A-Za-z0-9_.-]+)\s*([<>=!~].*)?$/); if (m) deps.push({ecosystem:'pip',name:m[1],version:(m[2]||'').trim()||'unspecified'});
      }
    } catch {}
  }
  return deps.slice(0,500);
}

function readiness(root, files, findings) {
  const rels = new Set(files.map(f=>path.relative(root,f).replace(/\\/g,'/').toLowerCase()));
  const isStaticWeb = rels.has('index.html') && !rels.has('package.json');
  const checks = isStaticWeb ? [
    ['Entry point', rels.has('index.html')],
    ['Application page', [...rels].some(x=>x==='game.html' || x.endsWith('/game.html'))],
    ['Local assets/data', [...rels].some(x=>/\.(?:webp|png|jpe?g|gif|svg|pgn|json)$/.test(x))],
    ['Tests', [...rels].some(x=>/(^|\/)(test|tests|__tests__)(\/|$)/.test(x))],
    ['CI', [...rels].some(x=>x.startsWith('.github/workflows/'))],
    ['License', [...rels].some(x=>x.startsWith('license'))]
  ] : [
    ['README', [...rels].some(x=>x==='readme.md' || x.startsWith('readme.'))],
    ['Tests', [...rels].some(x=>/(^|\/)(test|tests|__tests__)(\/|$)/.test(x))],
    ['CI', [...rels].some(x=>x.startsWith('.github/workflows/'))],
    ['Lockfile', ['package-lock.json','pnpm-lock.yaml','yarn.lock','poetry.lock','uv.lock'].some(x=>rels.has(x))],
    ['Env template', [...rels].some(x=>/\.env\.(example|sample)$/.test(x) || x==='.env.example')],
    ['License', [...rels].some(x=>x.startsWith('license'))]
  ];
  const base = Math.round(checks.filter(x=>x[1]).length / checks.length * 100);
  const exposurePenalty = Math.min(30, findings.exposure.length * 10);
  const realityPenalty = Math.min(25, findings.reality.length * 2);
  return {score:Math.max(0,base-exposurePenalty-realityPenalty),checks};
}

function makePlan(report) {
  const tools=['SpiderEye','Beam/Aluma','Bat-Sonar'];
  const actions=[];
  if (report.reports.exposure.items.length) {
    actions.push('Review and rotate exposed credentials before any write action.');
    return {decision:'NO_PLAN',reason:'Potential secret exposure requires human review before bounded change.',tools,actions};
  }
  if (report.reports.productReality.items.length) actions.push('Replace or verify MOCK / PLACEHOLDER / TODO findings in a sandbox copy.');
  if (report.reports.dependencies.items.length) actions.push('Verify dependency versions and external providers before change.');
  if (report.reports.readiness.score < 60) actions.push('Raise readiness evidence before release: tests, CI, lockfile and environment template.');
  if (!actions.length) actions.push('No urgent repair derived. Preserve evidence and continue monitoring.');
  tools.push('Magic Pencil');
  return {decision:'PLAN_READY',reason:'Evidence is sufficient for a bounded sandbox-first plan.',tools,actions};
}

function scanProject(root) {
  if (!root || !fs.existsSync(root)) throw new Error('Project folder does not exist.');
  const {files,truncated}=walk(root);
  const languageCounts={}; const topDirs={}; const findings={exposure:[],reality:[],data:[]};
  const endpoints=[]; const fingerprint=crypto.createHash('sha256'); let textFiles=0;

  for (const file of files) {
    const rel=path.relative(root,file).replace(/\\/g,'/');
    const ext=path.extname(file).toLowerCase();
    if (LANG[ext]) languageCounts[LANG[ext]]=(languageCounts[LANG[ext]]||0)+1;
    const first=rel.split('/')[0] || '(root)'; topDirs[first]=(topDirs[first]||0)+1;
    const text=safeRead(file);
    let stat; try {stat=fs.statSync(file);} catch {continue;}
    fingerprint.update(`${rel}|${stat.size}|${Math.floor(stat.mtimeMs)}\n`);
    if (text==null) continue;
    textFiles++;
    fingerprint.update(crypto.createHash('sha256').update(text).digest('hex'));
    const lines=text.split(/\r?\n/);
    if (ext === '.pgn') {
      const games=(text.match(/^\[Event\s+"/gm)||[]).length;
      if (games) findings.data.push({file:rel,line:0,signal:`PGN archive: ${games} games`});
    }
    for (let i=0;i<lines.length;i++) {
      const line=lines[i];
      for (const [kind,re] of SECRET_PATTERNS) if (re.test(line)) findings.exposure.push({file:rel,line:i+1,kind});
      for (const [kind,re] of REALITY_PATTERNS) {
        if (kind==='Placeholder' && isBenignPlaceholder(line)) continue;
        if (re.test(line)) findings.reality.push({file:rel,line:i+1,kind});
      }
      if (/\b(?:fetch|axios\.(?:get|post|put|delete)|https?:\/\/|firebase|prisma|mongoose|sequelize|SELECT\s+.+\s+FROM)\b/i.test(line)) {
        if (findings.data.length < 250) findings.data.push({file:rel,line:i+1,signal:line.trim().slice(0,140)});
      }
      const urlm=line.match(/https?:\/\/[^\s"'\`)]+/g); if (urlm) endpoints.push(...urlm.slice(0,5).map(u=>({file:rel,url:u.slice(0,180)})));
    }
  }

  const dependencies=parseDependencies(root);
  const uniqueEndpoints=[...new Map(endpoints.map(x=>[x.url,x])).values()];
  for (const ep of uniqueEndpoints) {
    try {
      const u=new URL(ep.url);
      if (!dependencies.some(d=>d.name===u.hostname)) dependencies.push({ecosystem:'external-web',name:u.hostname,version:'runtime'});
    } catch {}
  }
  const ready=readiness(root,files,findings);
  const extCounts={}; for(const f of files){const e=path.extname(f).toLowerCase()||'(none)';extCounts[e]=(extCounts[e]||0)+1;}
  const report={
    schema:'transformix.scan.v0.1',
    createdAt:new Date().toISOString(),
    root,
    readOnly:true,
    truncated,
    sourceSnapshotFingerprint:fingerprint.digest('hex'),
    stats:{files:files.length,textFiles,languages:languageCounts,extensions:extCounts},
    reports:{
      structure:{summary:`${files.length} files mapped; ${Object.keys(topDirs).length} top-level areas.`,topAreas:Object.entries(topDirs).sort((a,b)=>b[1]-a[1]).slice(0,30)},
      data:{summary:`${findings.data.length} data/API signals found.`,items:findings.data.slice(0,200),endpoints:uniqueEndpoints.slice(0,100)},
      exposure:{summary:`${findings.exposure.length} potential exposure findings.`,items:findings.exposure.slice(0,100)},
      productReality:{summary:`${findings.reality.length} actionable TODO/MOCK/PLACEHOLDER or environment signals after syntax filtering.`,items:findings.reality.slice(0,200)},
      dependencies:{summary:`${dependencies.length} declared dependencies.`,items:dependencies},
      readiness:{summary:`Readiness evidence score ${ready.score}/100.`,score:ready.score,checks:ready.checks},
      repairUpgrade:{summary:'Derived after evidence review; no source write is performed by scan.',items:[]}
    }
  };
  report.plutox=makePlan(report);
  report.reports.repairUpgrade.items=report.plutox.actions;
  report.evidence={class:'LOCAL_READ_ONLY_SCAN',status:'PROVEN WITH LIMITS',notes:['No source files were modified.','The scan is heuristic and does not prove semantic correctness.','Potential secrets are reported by location and kind; values are not returned.']};
  return report;
}

function createSandboxCopy(root) {
  if (!root || !fs.existsSync(root)) throw new Error('Project folder does not exist.');
  const parent=path.dirname(root); const base=path.basename(root); const stamp=new Date().toISOString().replace(/[:.]/g,'-');
  const dest=path.join(parent,`${base}-TRANSFORMIX-SANDBOX-${stamp}`);
  fs.cpSync(root,dest,{recursive:true,filter:(src)=>!src.split(path.sep).some(p=>IGNORE.has(p))});
  return dest;
}

module.exports={scanProject,createSandboxCopy};