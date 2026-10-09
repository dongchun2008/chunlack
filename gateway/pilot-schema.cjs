'use strict';
const P=require('./protocol.cjs');
const TYPE='browser.public_read',URL='https://example.com/';
function validatePilotInput(input){
  P.fields(input,['url','challenge']);
  if(input.url!==URL)P.fail('pilot_target_denied',403);
  if(typeof input.challenge!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(input.challenge)||Buffer.from(input.challenge,'base64url').length!==32||Buffer.from(input.challenge,'base64url').toString('base64url')!==input.challenge)P.fail('invalid_pilot_challenge');
  return {url:URL,challenge:input.challenge};
}
function validatePilotOutput(output,input){
  const expected=validatePilotInput(input);
  P.fields(output,['url','challenge','title','executedAt','artifactId','activityEvidence']);
  if(output.url!==expected.url||output.challenge!==expected.challenge)P.fail('pilot_result_mismatch');
  P.text(output.title,500);P.text(output.activityEvidence,2000);
  if(typeof output.executedAt!=='string'||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(output.executedAt)||!Number.isFinite(Date.parse(output.executedAt))||new Date(output.executedAt).toISOString()!==output.executedAt)P.fail('invalid_execution_time');
  if(typeof output.artifactId!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(output.artifactId))P.fail('invalid_artifact_id');
  return {...output};
}
module.exports={TYPE,validatePilotInput,validatePilotOutput};
