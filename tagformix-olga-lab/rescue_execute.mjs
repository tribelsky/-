/**
 * TAGFORMIX Rescue Squad 01.
 *
 * A signed symptom was admitted by the Python dispatcher, which selected
 * three Skills and combined their traits. THIS script exercises the
 * Scout -> Composer -> Verifier chain on in-memory Olga function damage.
 *
 * The composer only restores a single unexpected line against the last
 * tested baseline: useful bounded recovery, not open-ended AI invention.
 * The trusted upstream source remains untouched.
 */
import {readFileSync, mkdirSync, writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import vm from 'node:vm';
import {
  fixtures, actual, testAll, baseline, pinnedCommit, pinnedBlob
} from './olga-real-source-probe.mjs';

const dir='tagformix-olga-lab/out';
const planFile=dir+'/RESCUE-AUTHORIZED-DISPATCH.json';
const plans=JSON.parse(readFileSync(planFile,'utf8'));
const registry=JSON.parse(readFileSync('tagformix-olga-lab/rescue-traits.json','utf8'));
const originalDigest=Object.fromEntries(
  Object.entries(actual).map(([name,source])=>[name,sha(source)])
);
function sha(s){return createHash('sha256').update(s).digest('hex');}
function fail(message){throw new Error('SAFE STOP: '+message);}

function runReviewedFunction(source,name,context,args=[]){
  context.__args=args;
  vm.runInNewContext(source+'\n'+name+'(...__args);',context,
    {timeout:1000,filename:'sandbox-reviewed-'+name+'.js'});
}
function heldoutWorkflow(source){
  const board=Array.from({length:8},()=>Array(8).fill(''));
  board[5][5]='N';board[2][2]='n';
  const prev={whiteKingMoved:false,whiteRookKingsideMoved:false,
    whiteRookQueensideMoved:false,blackKingMoved:false,
    blackRookKingsideMoved:false,blackRookQueensideMoved:false};
  const ctx={
    board,moveCount:2,isWhiteTurn:true,selectedSquare:null,
    lastMoveSquares:[[0,1],[2,2]],castlingRights:{...prev},
    moveHistoryUCI:['g1f3','b8c6'],
    moveHistory:[
      {from:[7,6],to:[5,5],piece:'N',captured:'',
        lastMoveSquares:[],castlingRook:null,savedCastlingRights:prev},
      {from:[0,1],to:[2,2],piece:'n',captured:'',
        lastMoveSquares:[[7,6],[5,5]],castlingRook:null,savedCastlingRights:prev}
    ],
    updateSpeech(){},getRandomComment(){return 'test'},renderBoard(){},JSON
  };
  try{runReviewedFunction(source,'undoMove',ctx);}catch{return false;}
  return ctx.moveCount===0&&ctx.moveHistoryUCI.length===0&&
    ctx.moveHistory.length===0&&ctx.board[7][6]==='N'&&ctx.board[0][1]==='n'&&
    ctx.board[5][5]===''&&ctx.board[2][2]==='';
}
function heldoutRuntime(source){
  let count=0,observed=null;
  const context={
    getOpeningBookMove(){return null},stockfishReady:false,stockfish:null,
    findBestMoveFallback(){return {from:[0,1],to:[2,2]}},
    coordsToUCI(){return 'b8c6'},
    console:{warn(){},log(){}},setTimeout(){throw Error('unexpected')}
  };
  try{runReviewedFunction(source,'findBestMoveStockfish',context,[
    m=>{count++;observed=m}
  ]);}catch{return false;}
  return count===1&&observed==='b8c6';
}
function heldoutData(source){
  const stats={name:'אולגה',games:9,wins:4,losses:5,bestMoves:120};
  let writes=[];
  const context={
    STORAGE_KEY:'olga_chess_stats',playerStats:stats,JSON,
    localStorage:{setItem:(k,v)=>writes.push([k,v])},
    console:{log(){}}
  };
  try{runReviewedFunction(source,'saveStats',context);}catch{return false;}
  return writes.length===1&&writes[0][0]==='olga_chess_stats'&&
    JSON.parse(writes[0][1]).name==='אולגה'&&
    JSON.parse(writes[0][1]).bestMoves===120;
}
const heldout={
  workflow:heldoutWorkflow,runtime:heldoutRuntime,data:heldoutData
};
function scopedLineRepair(broken, verified){
  const a=broken.split('\n'),b=verified.split('\n');
  if(a.length!==b.length)fail('different function line count');
  const mismatch=[];
  for(let i=0;i<a.length;i++){if(a[i]!==b[i])mismatch.push(i);}
  if(mismatch.length!==1)fail('expected one-line edit within function');
  const line=mismatch[0];
  const candidate=a.slice();candidate[line]=b[line];
  const newSource=candidate.join('\n');
  if(newSource!==verified)fail('recovery did not match verified reference');
  return {newSource,diffLine:line+1,oldLine:a[line],newLine:b[line]};
}

if(plans.status!=='LOCAL_AUTOMATED_DISPATCH_PROVEN')fail('not authorized by dispatcher');
if(plans.source_commit!==pinnedCommit ||
   registry.limits.base_blob!==pinnedBlob ||
   registry.limits.base_commit!==pinnedCommit)fail('source lineage mismatch');
if(plans.scope!=='ISOLATED_LOCAL_CANDIDATE_ONLY')fail('outside sandbox scope');
if(plans.rescue_plans?.length!==3 || baseline.some(x=>!x.passed)){
  fail('baseline or case count mismatch');
}
const outputs=[];
const usedPaths=new Set();
for(const p of plans.rescue_plans){
  const selected=registry.domain_traits[p.areas?.[0]];
  if(!selected||p.status!=='CANDIDATE_ALLOWED')fail('unclassified alert');
  if(p.skills.length!==3 ||
     p.skills.map(x=>x.role).join(',')!=='scout,builder,verifier' ||
     p.skills[0].id!==registry.roles.scout.skill_id ||
     p.skills[1].id!==registry.roles.builder.skill_id ||
     p.skills[2].id!==registry.roles.verifier.skill_id)fail('illegal skill dispatch');
  if(!p.skills.every(x=>x.authority!=='PRODUCTION_WRITE'))fail('unsafe skill');
  if(p.deployment_authorized!==false || p.remote_skills_transmitted!==false){
    fail('unexpected release privileges');
  }
  const f=fixtures.find(x=>x.name===selected.function);
  if(!f || usedPaths.has(f.name) || p.target_function!==f.name ||
     selected.check!==p.target_check ||
     selected.fault_type!==p.target_fault_type ||
     p.traits_from_reservoir[0]!==selected.trait_id){
    fail('trait does not match named Olga symptom');
  }
  usedPaths.add(f.name);
  const verified=actual[f.name];
  if(verified.split(f.needle).length!==2)fail('verified function changed');
  const damaged=verified.replace(f.needle,f.replacement);
  // Scout: behavioral mismatch and one actually localized line
  const failure=f.test(damaged);
  const otherOriginalTests=testAll({[f.name]:damaged});
  if(failure.passed || otherOriginalTests.filter(x=>!x.passed).length!==1||
     failure.area!==p.areas[0] || heldout[p.areas[0]](damaged)){
    fail('could not corroborate reported fault');
  }
  // Builder: select a rollback/diff trait from the shared reservoir.
  // Not a free-form generated algorithm: no auto-repair without prior baseline.
  const candidate=scopedLineRepair(damaged,verified);
  // Verifier: independent contract variations and all three regressions.
  const local=f.test(candidate.newSource);
  const all=testAll({[f.name]:candidate.newSource});
  const holdout=heldout[p.areas[0]](candidate.newSource);
  const untouchedAreas=all.filter(x=>x.check!==p.target_check).every(x=>x.passed);
  if(!local.passed || !holdout || !all.every(x=>x.passed) || !untouchedAreas){
    fail('candidate failed independent verification gate');
  }
  if(p.max_changed_functions!==1||p.max_attempts_per_incident!==1){
    fail('unauthorized number of changes or attempts');
  }
  const patchHeader='--- a/sandbox-only/'+f.name+'.js\n'+
                    '+++ b/sandbox-only/'+f.name+'.js\n';
  const patch=patchHeader+'@@ -'+candidate.diffLine+',1 +'+
      candidate.diffLine+',1 @@\n-'+candidate.oldLine+'\n+'+
      candidate.newLine+'\n';
  mkdirSync(dir+'/patches',{recursive:true});
  const patchName=dir+'/patches/'+f.name+'.candidate.patch';
  writeFileSync(patchName,patch,'utf8');
  outputs.push({
    area:p.areas[0],app:plans.app,original_source:pinnedCommit,
    skills:p.skills,
    composition:[...p.skills.flatMap(x=>x.traits)],
    original_function:f.name,
    symptom_contract:p.target_check,
    diagnostic:{baseline_passing:true,damaged_fails:true,
      damaged_heldout_fails:true,other_original_tests_unaffected:true},
    builder:{strategy:'restore-one-changed-line-from-verified-baseline',
      patch_file:patchName,patch_sha256:sha(patch),
      original_source_function_sha256:originalDigest[f.name],
      modified_candidate_sha256:sha(candidate.newSource),
      changed_lines:1},
    verifier:{local_contract_pass:true,holdout_pass:holdout,
      all_regression_tests_pass:all.length,
      unsafe_deployment_attempted:false},
    patch_applied_to_live_olga:false,
    action:'CANDIDATE_READY_FOR_HUMAN_REVIEW',
  });
}
if(outputs.length!==3 ||
   !Object.keys(actual).every(k=>sha(actual[k])===originalDigest[k])){
  fail('missing results or source changed during lab');
}
// Defense in depth: large edits must be rejected, even when a known-good
// reference exists.
const one=fixtures[0],v=actual[one.name];
const multiple=v.replace(one.needle,one.replacement)
  .replace('moveHistoryUCI.pop();','void 0;');
let negativeMultiBlocked=false;
try{scopedLineRepair(multiple,v)}catch(e){
  negativeMultiBlocked=String(e).includes('SAFE STOP');
}
if(!negativeMultiBlocked)fail('multiple-change negative test failed');

const summary={
  experiment:registry.experiment,status:'THREE_SKILLS_COMPOSED_AND_SANDBOX_CANDIDATES_VERIFIED',
  source_commit:pinnedCommit,source_blob_sha1:pinnedBlob,
  protocol:'signed alert -> Beam triage -> scoped 3 Skills -> one-line recovery -> verifier',
  cases:outputs,case_count:outputs.length,
  verified_sandbox_recoveries:outputs.length,
  multiple_change_negative_control_blocked:true,
  independently_invented_new_algorithm:false,
  algorithm_scope:'Recombined predetermined traits; restored verified source baseline.',
  real_app_modified:false,actual_skills_sent_over_network:0,
  automated_production_repair:false,customer_consent_to_real_deployment:false,
  whole_browser_game_tested:false,
  caveats:['One-line mutation fixtures injected by same lab author',
    'Held-out tests use different synthetic state but not independent researchers',
    'Recovery uses known-good function reference and cannot solve unknown faults',
    'Not a remotely installed skill fleet or production subscription service']
};
writeFileSync(dir+'/RESCUE-VERIFIED-CANDIDATES.json',
              JSON.stringify(summary,null,2)+'\n');
console.log(JSON.stringify({result:'PASS',
  automatically_selected_teams:outputs.length,skills_per_team:3,
  verified_sandbox_recovery_cases:outputs.length,
  categories:outputs.map(x=>x.area),
  negative_multiple_edits_stopped:true,
  external_app_changes:0}));
