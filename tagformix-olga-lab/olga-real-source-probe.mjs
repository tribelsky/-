/**
 * Tagformix Olga pilot. Executes a reviewed subset of pinned real Olga source
 * with mocked states, then corrupts only extracted in-memory function strings.
 * No changes to the real Olga app, website, or original GitHub branch.
 */
import {readFileSync, writeFileSync, mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import vm from 'node:vm';
const pinnedCommit='6177a9144e4b6c8035e0224b90810e2241f6966d';
const pinnedBlob='e9874ebc58be579ce50aae89fa566b0dba1b6384';
const appPath=process.argv[2];
if(!appPath)throw new Error('Pinned Olga source path required');
const html=readFileSync(appPath,'utf8');
const hash=createHash('sha1').update(Buffer.concat([
 Buffer.from('blob '+Buffer.byteLength(html,'utf8')+'\0'),Buffer.from(html,'utf8')
])).digest('hex');
if(hash!==pinnedBlob)throw new Error('Original Olga source differs: '+hash);
function extract(name){
 const token='function '+name+'(';
 const start=html.indexOf(token);
 if(start<0||html.indexOf(token,start+1)>=0)throw Error('Missing or duplicate '+name);
 const brace=html.indexOf('{',start);
 let depth=0;
 for(let i=brace;i<html.length;i++){
  if(html[i]==='{')depth++;
  if(html[i]==='}'){
   depth--;
   if(depth===0)return html.slice(start,i+1);
  }
 }
 throw Error('Unclosed '+name);
}
function run(code,name,ctx,args=[]){
 ctx.__args=args;
 vm.runInNewContext(code+'\n'+name+'(...__args);',ctx,{timeout:1000});
}
const rights={
 whiteKingMoved:false,whiteRookKingsideMoved:false,
 whiteRookQueensideMoved:false,blackKingMoved:false,
 blackRookKingsideMoved:false,blackRookQueensideMoved:false
};
function testUndo(code){
 const board=Array.from({length:8},()=>Array(8).fill(''));
 board[4][4]='P';board[3][4]='p';
 const mk=(from,to,piece,lastMoveSquares)=>({
  from,to,piece,captured:'',lastMoveSquares,castlingRook:null,savedCastlingRights:rights
 });
 const ctx={
  board,moveHistory:[
   mk([6,4],[4,4],'P',[]),
   mk([1,4],[3,4],'p',[[6,4],[4,4]])
  ],moveHistoryUCI:['e2e4','e7e5'],moveCount:2,castlingRights:{...rights},
  isWhiteTurn:true,lastMoveSquares:[[1,4],[3,4]],selectedSquare:null,
  getRandomComment:()=> 'fixture',updateSpeech:()=>{},renderBoard:()=>{},JSON
 };
 let error=null;
 try{run(code,'undoMove',ctx);}catch(e){error=String(e).slice(0,140);}
 const observed={
  moveCount:ctx.moveCount,historyEmpty:ctx.moveHistory.length===0,
  uciEmpty:ctx.moveHistoryUCI.length===0,
  originalSquaresRestored:ctx.board[6][4]==='P'&&ctx.board[1][4]==='p'&&
    ctx.board[4][4]===''&&ctx.board[3][4]==='',error
 };
 return {check:'undo_history',area:'workflow',fault_type:'GAMEPLAY_HISTORY',
   passed:observed.moveCount===0&&observed.historyEmpty&&observed.uciEmpty&&
    observed.originalSquaresRestored&&!error,observed};
}
function testEngine(code){
 let called=0,move=null;
 const ctx={getOpeningBookMove:()=>null,stockfishReady:false,stockfish:null,
  findBestMoveFallback:()=>({from:[1,4],to:[3,4]}),
  coordsToUCI:()=> 'e7e5',
  console:{warn(){},log(){}},
  setTimeout:()=>{throw Error('Unexpected opening-book branch');}
 };
 let error=null;
 try{run(code,'findBestMoveStockfish',ctx,[(uci)=>{called++;move=uci;}]);}
 catch(e){error=String(e).slice(0,140);}
 return {check:'engine_fallback',area:'runtime',fault_type:'ENGINE_FALLBACK_STALL',
   passed:called===1&&move==='e7e5'&&!error,
   observed:{callbackCount:called,move,error}};
}
function testStorage(code){
 const stats={name:'Olga Lab',games:3,wins:1,losses:2,bestMoves:42};
 const saved=[];
 const ctx={STORAGE_KEY:'olga_chess_stats',playerStats:stats,JSON,
  localStorage:{setItem:(key,value)=>saved.push([key,value])},console:{log(){}}
 };
 let error=null;
 try{run(code,'saveStats',ctx);}catch(e){error=String(e).slice(0,140);}
 const observed={oneWrite:saved.length===1,
  keyCorrect:saved.length===1&&saved[0][0]==='olga_chess_stats',
  payloadCorrect:saved.length===1&&saved[0][1]===JSON.stringify(stats),error};
 return {check:'stats_persistence',area:'data',fault_type:'LOCAL_STATS_STORAGE',
   passed:observed.oneWrite&&observed.keyCorrect&&observed.payloadCorrect&&!error,
   observed};
}
const fixtures=[
 {name:'undoMove',test:testUndo,needle:'moveCount -= 2;',replacement:'moveCount += 2;'},
 {name:'findBestMoveStockfish',test:testEngine,needle:'if (move) {',replacement:'if (false) {'},
 {name:'saveStats',test:testStorage,
  needle:'localStorage.setItem(STORAGE_KEY, JSON.stringify(playerStats));',
  replacement:'void JSON.stringify(playerStats);'}
];
const actual=Object.fromEntries(fixtures.map(f=>[f.name,extract(f.name)]));
for(const f of fixtures){
 if(actual[f.name].split(f.needle).length!==2)throw Error('Unique injection marker missing: '+f.name);
}
const testAll=mod=>fixtures.map(f=>f.test((mod||{})[f.name]||actual[f.name]));
const baseline=testAll();
if(!baseline.every(t=>t.passed))throw Error('Original Olga baseline failed '+JSON.stringify(baseline));
const incidents=[];
for(const f of fixtures){
 const mod={};mod[f.name]=actual[f.name].replace(f.needle,f.replacement);
 const result=testAll(mod);
 const failed=result.filter(t=>!t.passed);
 const expected=f.test(actual[f.name]);
 if(failed.length!==1 || failed[0].check!==expected.check ||
   failed[0].area!==expected.area)throw Error('Misclassified fault '+f.name);
 incidents.push({injected_function:f.name,expected_area:expected.area,
  diagnosed_area:failed[0].area,diagnosed_fault_type:failed[0].fault_type,
  failed_check:failed[0].check,other_checks_stayed_healthy:true,
  fault_execution:result,changed_original_app:false});
}
const report={
 experiment:'TAGFORMIX-OLGA-FUNCTION-FAULT-LAB-01',as_of:'2026-10-12',
 repo:'tribelsky/-',app_path:'olga-chess/game.html',
 source_commit:pinnedCommit,source_blob_sha1:pinnedBlob,
 source_sha256:createHash('sha256').update(html).digest('hex'),
 baseline,baseline_passed:baseline.length,
 isolated_faults:incidents,category_correct:incidents.length,
 no_unrelated_false_alarms:true,
 seal_scope:'FUNCTION_TESTS_ONLY_NOT_FULL_REPAIR',
 no_production_app_changes:true,no_real_monitoring:true,
 limits:['Only 3 original functions executed in mocked Node VM',
 'Faults injected in temporary function copies, not Olga HTML',
 'No full-game browser integration or browser storage test',
 'No real application repaired or production tag installed']
};
mkdirSync('tagformix-olga-lab/out',{recursive:true});
writeFileSync('tagformix-olga-lab/out/OLGA-REAL-SOURCE-RESULT.json',
 JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({result:'PASS',original_source_verified:true,
 baseline:baseline.length,broken_probes:incidents.length,
 categories:incidents.map(x=>x.diagnosed_area),original_app_unchanged:true}));

// The owned sandbox Rescue Squad reuses exactly these original-source fixtures.
export { fixtures, actual, testAll, baseline, pinnedCommit, pinnedBlob };
