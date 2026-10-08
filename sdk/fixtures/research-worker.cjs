'use strict';
// A deterministic fixture, never a substitute for real retrieval or reasoning.
async function handler({task,signal}){
  signal?.throwIfAborted();const data=task.input;
  if(data.fixture!==true)throw new Error('Fixture handler only accepts explicit mock tasks');
  if(task.taskType==='research.retrieve')return {sources:[{url:'https://example.org/fixture',excerpt:'The fixture launched in 2020.'}],claims:[{text:'The fixture launched in 2020.',sourceIndex:0}],missingEvidence:[]};
  if(task.taskType==='research.verify')return {decisions:data.claims.map(claim=>{
    const source=data.sources.find(s=>s.sourceId===claim.sourceId);const quote='The fixture launched in 2020.';
    const supported=claim.text===quote&&source?.excerpt.includes(quote);
    return {claimId:claim.claimId,status:supported?'supported':'insufficient_evidence',reason:supported?'The known fixture sentence matches.':'This fixture cannot verify that claim.',evidence:supported?[{sourceId:source.sourceId,quote}]:[]};
  })};
  if(task.taskType==='research.summarize')return {claimIds:data.claims.map(claim=>claim.claimId)};
  throw new Error('Unsupported fixture task');
}
module.exports={handler};
