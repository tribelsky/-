// Additional isolated variant tests for pinned AnythingLLM function candidates.
// No external import execution; only reviewed function in dependency-mocked VM.
const fs=require('node:fs');
const vm=require('node:vm');
(async()=>{
 const code=fs.readFileSync(process.argv[2],'utf8');
 const sandbox={
  module:{exports:{}},
  require:(id)=>{
   if(id==='../utils/prisma')return {};
   if(id==='moment')return ()=>({format:()=> 'MOCKED_DATE'});
   throw Error('Unexpected module '+id);
  },
  console:{error(){}}
 };
 vm.runInNewContext(code,sandbox,{timeout:1500});
 const sut=sandbox.module.exports.SystemPromptVariables;
 if(!sut||typeof sut.expandSystemPromptVariables!=='function'){
  throw Error('Pinned upstream entrypoint missing');
 }
 sut.getAll=async()=>[
  {key:'first',type:'static',value:'X {second}'},
  {key:'second',type:'static',value:'Y'}
 ];
 const fixtures=[
  ['base','{first} {second}','X {second} Y'],
  ['duplicate_original_slots','[{second}][{second}]','[Y][Y]'],
  ['unknown_placeholder','keep {missing}','keep {missing}'],
  ['inserted_placeholder_literality','{first} | {first}', 'X {second} | X {second}'],
  ['ordinary_value','prefix {second} suffix','prefix Y suffix']
 ];
 const cases=[];
 for(const [testName,input,expected] of fixtures){
  const actual=await sut.expandSystemPromptVariables(input);
  cases.push({test:testName,pass:actual===expected,expected,actual});
 }
 process.stdout.write(JSON.stringify({status:'ISOLATED_VARIANT_SUITE',cases})+'\n');
 if(cases.some(x=>!x.pass))process.exitCode=2;
})().catch(error=>{
 process.stderr.write(String(error&&error.stack||error));
 process.exitCode=1;
});
