'use strict';
// CROSS-APP SKILL METAMORPHOSIS — EXECUTABLE PROOF v0.2
// Tests real, SHA-pinned host code; only network/service boundaries are mocked.
// No writes to external repositories or live application services.
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const vm = require('vm'), cp = require('child_process'), ts = require('typescript');
const host = process.argv[2], root = path.resolve(process.argv[3] || '.'), out = process.argv[4];
if (!['OpenHands','Activepieces'].includes(host) || !out) throw Error('host, root, output required');
const lineage = JSON.parse(fs.readFileSync(path.join(__dirname,'lineage.json'),'utf8'));
const parent = lineage.parent_skills.find(x => x.platform === host);
if (!parent) throw Error('No skill lineage for host');
const commit = cp.execFileSync('git',['-C',root,'rev-parse','HEAD'],{encoding:'utf8'}).trim();
if (commit !== parent.commit) throw Error('Source checkout is not pinned to approved commit');
const rel = host === 'OpenHands' ? 'src/api/skills-service.ts'
  : 'packages/pieces/community/google-sheets/src/index.ts';
const actionRel = 'packages/pieces/community/google-sheets/src/lib/actions/get-rows.ts';
const read = p => fs.readFileSync(path.join(root,p),'utf8');
const sha = s => crypto.createHash('sha256').update(s).digest('hex');
const gitBlob = s => { const b=Buffer.from(s); return crypto.createHash('sha1').update(Buffer.concat([Buffer.from('blob '+b.length+'\0'),b])).digest('hex'); };
if (gitBlob(read(parent.file)) !== parent.blob_sha) throw Error('Parent skill SHA does not match');
const composite = fs.readFileSync(path.join(__dirname,'../.agents/skills/cross-app-contract-builder-verifier/SKILL.md'),'utf8');
if (!composite.startsWith('---\nname: cross-app-contract-builder-verifier\n')) throw Error('Composite skill not found');
const sf = (name,source) => {
  const f=ts.createSourceFile(name,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);
  if (f.parseDiagnostics.length) throw Error('Typescript parser failure for '+name);
  return f;
};
const all = (node,pred) => {const a=[];const visit=x=>{if(pred(x))a.push(x);ts.forEachChild(x,visit);};visit(node);return a;};
const decl = (f,name) => all(f,n=>ts.isVariableDeclaration(n)&&n.name.getText(f)===name)[0];
const prop = (obj,key,f) => obj && ts.isObjectLiteralExpression(obj)
 ? obj.properties.find(x=>ts.isPropertyAssignment(x) && x.name.getText(f)===key) : undefined;
const val = (obj,key,f) => prop(obj,key,f)?.initializer.getText(f);
const check = (id,ok,note) => ({id,pass:!!ok,note});
const trans = code => ts.transpileModule(code,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText;
async function openHands(code) {
  const f=sf(rel,code), gates=[];
  const c=all(f,n=>ts.isClassDeclaration(n)&&n.name?.text==='SkillsService')[0];
  const fn=c?.members.find(n=>ts.isMethodDeclaration(n)&&n.name.getText(f)==='getSkills');
  gates.push(check('native_skill_loader',!!fn,'Read upstream SkillsService.getSkills'));
  if(!fn)return {gates,runtime:false};
  const route=all(fn,ts.isIfStatement).find(n=>n.expression.getText(f).includes('getActiveBackend()')&&n.expression.getText(f).includes('cloud'));
  gates.push(check('cloud_backend_route',!!route&&route.thenStatement.getText(f).includes('fetchCloudSkills()'),'Cloud skills kept separate'));
  const call=all(fn,ts.isCallExpression).find(n=>n.expression.getText(f).endsWith('.getSkills') && n.arguments.length===1);
  const opt=call?.arguments[0];
  for(const [key,want] of [['load_project','true'],['load_user','true'],['load_public','false'],['load_org','false']]){
    gates.push(check(key,val(opt,key,f)===want,'Require '+key+'='+want));
  }
  gates.push(check('project_scope',String(val(opt,'project_dir',f)).includes('getAgentServerWorkingDir'),'Project-scoped loading'));
  const arr=all(fn,ts.isReturnStatement).some(n=>n.expression&&ts.isArrayLiteralExpression(n.expression)&&n.expression.elements.length===2&&n.expression.elements.every(ts.isSpreadElement));
  gates.push(check('merged_skill_catalog',arr,'Merge local and bundled catalog'));
  let target='local', calls=[], cloudCalls=0;
  const sandbox={
    SkillsClient:class{async getSkills(options){calls.push(options);return{skills:[{name:'local'}]};}},
    getActiveBackend:()=>({backend:{kind:target}}),
    fetchCloudSkills:async()=>{cloudCalls++;return[{name:'cloud'}];},
    fetchCloudConversationSkills:async()=>[],
    getAgentServerWorkingDir:()=>'/safe/project',
    getAgentServerClientOptions:()=>({}),
    PUBLIC_SKILLS:[{name:'catalog'}]
  };
  try{
    vm.runInNewContext(trans(c.getText(f))+'\nthis.SUT=SkillsService;',sandbox,{timeout:1200});
    const local=await sandbox.SUT.getSkills('/safe/project');
    target='cloud';const cloud=await sandbox.SUT.getSkills('/safe/project');
    const ok=local.map(x=>x.name).join(',')==='local,catalog' && cloud.map(x=>x.name).join(',')==='cloud'
      && calls.length===1 && calls[0].load_project===true && calls[0].load_public===false && cloudCalls===1;
    gates.push(check('execute_original_local_and_cloud_method',ok,'Real host method executed, clients mocked'));
    return {gates,runtime:ok,behavior:{local_names:local.map(x=>x.name),cloud_names:cloud.map(x=>x.name),client_calls:calls.length,cloud_calls:cloudCalls}};
  }catch(e){gates.push(check('execute_original_local_and_cloud_method',false,String(e)));return{gates,runtime:false};}
}
async function activepieces(code,actionCode){
  const f=sf(rel,code),a=sf(actionRel,actionCode),gates=[];
  const piece=decl(f,'googleSheets'),action=decl(a,'getRowsAction');
  const po=piece?.initializer?.arguments[0],ao=action?.initializer?.arguments[0];
  gates.push(check('native_piece_factory',piece?.initializer?.expression?.getText(f)==='createPiece','Actual host createPiece'));
  gates.push(check('native_action_factory',action?.initializer?.expression?.getText(a)==='createAction','Actual host createAction'));
  const list=prop(po,'actions',f)?.initializer;
  gates.push(check('piece_action_registered',!!list&&ts.isArrayLiteralExpression(list)&&list.elements.some(e=>e.getText(f)==='getRowsAction'),'Action belongs to real Google Sheets piece'));
  gates.push(check('matching_auth_contract',val(po,'auth',f)==='googleSheetsAuth'&&val(ao,'auth',a)==='googleSheetsAuth','Piece and action reference same auth'));
  gates.push(check('read_contract',val(ao,'classification',a)==="'READ'"&&val(ao,'name',a)==="'get_next_rows'",'Classified read operation with stable name'));
  const fn=all(a,n=>ts.isFunctionDeclaration(n)&&n.name?.text==='getRows')[0];
  gates.push(check('native_action_and_helper',!!fn&&!!action,'Actual existing TypeScript helper and action'));
  let writes=0;const auth={key:'mock'};
  const sandbox={
    createAction:x=>x,googleSheetsAuth:auth,commonProps:{},
    Property:new Proxy({}, {get:(_,k)=>v=>({kind:String(k),...v})}),
    notes:'',getNextRowsActionOutputSchema:{},StoreScope:{FLOW:'FLOW'},isNil:x=>x==null,
    getWorkSheetGridSize:async()=>({rowCount:12}),
    googleSheetsCommon:{getGoogleSheetRows:async q=>{if(q.auth!==auth)throw Error('Wrong auth');return[{value:'PASS'}];}},
    mapRowsToHeaderNames:async rows=>rows,areSheetIdsValid:()=>true,
    propsValidation:{validateZod:async()=>true},
    z:{number:()=>({check:()=>true}),minimum:()=>true},
    HttpError:class HttpError extends Error{}
  };
  try{
    vm.runInNewContext(trans(fn.getText(a)+'\nconst getRowsAction='+action.initializer.getText(a)+';\nthis.SUT=getRowsAction;'),sandbox,{timeout:1200});
    const ctx={auth,store:{get:async()=>null,put:async()=>{writes++;}},
      propsValue:{startRow:1,groupSize:2,memKey:'safe',headerRow:1,spreadsheetId:'mock',sheetId:12,useHeaderNames:true}};
    const test=await sandbox.SUT.test(ctx);const noWrite=writes===0;
    const run=await sandbox.SUT.run(ctx);
    const ok=test.length===1&&test[0].value==='PASS'&&run.length===1&&run[0].value==='PASS'&&noWrite&&writes===1;
    gates.push(check('execute_original_action_test_and_run',ok,'Real host action executed; mocked Google Sheets transport and store'));
    return{gates,runtime:ok,behavior:{test_output:Array.from(test),run_output:Array.from(run),writes,external_network_calls:0}};
  }catch(e){gates.push(check('execute_original_action_test_and_run',false,String(e)));return{gates,runtime:false};}
}
(async()=>{
  const original=read(rel), action=host==='OpenHands'?null:read(actionRel);
  const evalHost = body => host==='OpenHands'?openHands(body):activepieces(body,action);
  const baseline=await evalHost(original);
  const benign=await evalHost(original+'\n// benign: load_project false / auth undefined are COMMENT text\n');
  let mutant;
  if(host==='OpenHands'){
    if(!original.includes('load_project: true'))throw Error('Mutation site moved');
    mutant=original.replace('load_project: true','load_project: false');
  }else{
    const signature='\n\tauth: googleSheetsAuth,\n});';
    if(!original.includes(signature))throw Error('Mutation site moved');
    mutant=original.replace(signature,'\n\tauth: undefined,\n});');
  }
  const broken=await evalHost(mutant);
  const brokenGate=host==='OpenHands'?'load_project':'matching_auth_contract';
  const controls={
    harmless_comment_passed:benign.gates.every(g=>g.pass)&&benign.runtime,
    seeded_auth_or_registration_error_detected:broken.gates.some(g=>g.id===brokenGate&&!g.pass),
    injected_break:brokenGate
  };
  const pass=baseline.gates.every(g=>g.pass)&&baseline.runtime&&controls.harmless_comment_passed&&controls.seeded_auth_or_registration_error_detected;
  const report={
    experiment:'CROSS-APP-SKILL-METAMORPHOSIS-REAL-CODE-02',host,status:pass?'PASS':'FAIL',
    source_commit:commit,parent_skill:{name:parent.id,blob_sha:parent.blob_sha},
    source_files:[{path:rel,sha256:sha(original)}].concat(action?[{path:actionRel,sha256:sha(action)}]:[]),
    combined_skill_sha256:sha(composite),
    shared_core:'contract → auth/scoping → registration → real handler smoke-test → negative/benign control',
    original_code_checks:baseline.gates,
    original_code_behavior:baseline.behavior||null,
    controls,
    evidence_class:'real pinned upstream methods and metadata, mocked I/O, no full application deployment',
    outside_repositories_modified:0,
    standalone_skill_loaded_into_both_full_apps:false
  };
  fs.mkdirSync(path.dirname(out),{recursive:true});fs.writeFileSync(out,JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({host,status:report.status,original_checks:report.original_code_checks.length,controls:report.controls}));
  if(!pass)process.exitCode=1;
})().catch(e=>{console.error(e.stack||String(e));process.exitCode=1;});
