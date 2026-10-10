'use strict';
const {LIMITS}=require('./protocol.cjs');
// Static connector contract: never derive addresses or credentials from a request.
function createPilotOpenApi({multiUser=false,publicOrigin}={}){
  let servers;
  if(publicOrigin!==undefined){let url;try{url=new URL(publicOrigin);}catch{throw new Error('invalid_connector_origin');}if(url.protocol!=='https:'||url.username||url.password||url.port||url.pathname!=='/'||url.search||url.hash||!/^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/.test(url.hostname))throw new Error('invalid_connector_origin');servers=[{url:url.origin}];}
  const ref=name=>({$ref:'#/components/schemas/'+name});
  const id={type:'string',pattern:'^[A-Za-z0-9_-]{1,100}$'};
  const object=(properties,required=Object.keys(properties))=>({type:'object',properties,...(required.length?{required}:{}),additionalProperties:false});
  const attempt={type:'integer',minimum:1,maximum:3};
  const lease={taskId:id,leaseId:id,attempt};
  const base={protocolVersion:{type:'integer',enum:[1]},...lease,eventId:id};
  const acceptance=object({state:{type:'string',enum:['received','evidence_checked','accepted']},artifactId:{type:'string',nullable:true},acceptedAt:{type:'integer',format:'int64',nullable:true}});
  const schemas={
    Error:object({error:{type:'string'}}),
    ClaimRequest:object({taskId:id},[]),
    PilotInput:object({url:{type:'string',enum:['https://example.com/']},challenge:{type:'string',minLength:43,maxLength:43,pattern:'^[A-Za-z0-9_-]{43}$',description:'Canonical base64url encoding of 32 random bytes; preserve exactly.'}}),
    PilotOutput:object({url:{type:'string',enum:['https://example.com/']},challenge:{type:'string',minLength:43,maxLength:43},title:{type:'string',minLength:1,maxLength:500},executedAt:{type:'string',format:'date-time',pattern:'^\\d{4}-\\d\\d-\\d\\dT\\d\\d:\\d\\d:\\d\\d\\.\\d{3}Z$',description:'Actual execution time, UTC with milliseconds.'},artifactId:{type:'string',format:'uuid',pattern:'^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'},activityEvidence:{type:'string',minLength:1,maxLength:2000,description:'Reference or description of actual vendor Agent browser activity; not model-generated evidence.'}}),
    Acceptance:acceptance,
    TaskView:object({taskId:id,taskType:{type:'string',enum:['browser.public_read']},scopeId:{type:'string',enum:['public']},status:{type:'string'},input:ref('PilotInput'),deadlineAt:{type:'integer',format:'int64'},acceptance:ref('Acceptance')}),
    TaskLease:object({protocolVersion:{type:'integer',enum:[1]},taskId:id,taskType:{type:'string',enum:['browser.public_read']},targetNodeId:id,scopeId:{type:'string',enum:['public']},input:ref('PilotInput'),deadlineAt:{type:'integer',format:'int64'},leaseId:id,leaseUntil:{type:'integer',format:'int64'},attempt,traceId:id,researchSessionId:{...id,nullable:true}}),
    LeaseRequest:object(lease),
    LeaseState:object({taskId:id,status:{type:'string',enum:['running','cancel_requested']},leaseUntil:{type:'integer',format:'int64'}}),
    EventRequest:object({...base,type:{type:'string',enum:['started','progress','cancelled']},message:{type:'string',minLength:1,maxLength:2000}},[...Object.keys(base),'type']),
    SuccessResult:object({...base,status:{type:'string',enum:['succeeded']},output:ref('PilotOutput')}),
    Acknowledgement:{type:'object',description:'Transport acknowledgement only; accepted does not mean human acceptance.',additionalProperties:true},
    Artifact:{type:'object',required:['artifactId'],properties:{artifactId:{type:'string',format:'uuid'}},additionalProperties:true},
    NodeSnapshot:{type:'object',description:'Current authenticated public node; no node selector is accepted.',additionalProperties:true},
    Manifest:object({protocolVersion:{type:'integer',enum:[1]},nodeId:id,capabilities:{type:'array',items:{type:'string',enum:['browser.public_read']}},scopes:{type:'array',items:{type:'string',enum:['public']}},limits:{type:'object',additionalProperties:{type:'integer'}}}),
    NodeHeartbeat:object({capabilities:{type:'array',items:{type:'string',enum:['browser.public_read']}}},[])
  };
  if(multiUser)for(const name of ['TaskView','TaskLease','LeaseState','Manifest']){schemas[name].properties.workspaceId=id;schemas[name].required.push('workspaceId');}
  const json=schema=>({'application/json':{schema}});
  const success=(schema,description='Successful response')=>({description,content:json(schema)});
  const error=description=>success(ref('Error'),description);
  const errors={'400':error('Invalid request'),'401':error('Missing or revoked node credential'),'403':error('Node or task scope denied'),'404':error('Unknown route or task'),'409':error('Invalid lease or conflicting replay'),'413':error('Request too large'),'415':error('Wrong content type'),'429':error('Rate limit'),'500':error('Internal failure'),'503':error('Facade closed')};
  const op=(operationId,description,responses,extra={})=>({operationId,description,responses:{...errors,...responses},...extra});
  const body=schema=>({required:true,content:json(schema)});
  const taskParameter={name:'taskId',in:'path',required:true,schema:id};
  const paths={
    '/health':{get:op('getPilotHealth','Liveness only, not model or Agent verification.',{'200':success(object({status:{type:'string',enum:['ok']},mode:{type:'string',enum:['pilot_only']}}))},{security:[]})},
    '/v1/openapi.json':{get:op('getPilotOpenApi','Authenticated, deployment-neutral connector description.',{'200':success({type:'object',additionalProperties:true})})},
    '/v1/manifest':{get:op('getPilotManifest','Read protocol and capability limits without claiming a task.',{'200':success(ref('Manifest'))})},
    '/v1/agents/me':{get:op('getPilotNode','Read only the authenticated node.',{'200':success(ref('NodeSnapshot'))})},
    '/v1/agents/me/heartbeat':{post:op('heartbeatPilotNode','Node presence update; does not renew a task lease.',{'200':success(ref('NodeSnapshot'))},{requestBody:body(ref('NodeHeartbeat'))})},
    '/v1/tasks/{taskId}':{get:op('readPilotTask','Read an owned public task without disclosing its lease or executing it.',{'200':success(ref('TaskView'))},{parameters:[taskParameter]})},
    '/v1/tasks/claim':{post:op('claimPilotTask','With taskId, claim only that approved task; never fall back to another. Legacy {} claims the oldest queued task. This operation mutates state; do not probe or automatically repeat computer execution.',{'200':success(ref('TaskLease')),'204':{description:'No eligible task or global active slot unavailable; no response body.'}},{requestBody:body(ref('ClaimRequest'))})},
    '/v1/tasks/{taskId}/heartbeat':{post:op('renewPilotTask','Renew about every 30 seconds. Stop on cancel_requested or lease/auth failure. Maximum lease '+LIMITS.leaseMs+' ms; never exceeds task deadline.',{'200':success(ref('LeaseState'))},{parameters:[taskParameter],requestBody:body(ref('LeaseRequest'))})},
    '/v1/tasks/{taskId}/events':{post:op('reportPilotActivity','Record actual activity with stable event IDs; retry only identical envelopes. Task ID must match path.',{'200':success(ref('Acknowledgement'))},{parameters:[taskParameter],requestBody:body(ref('EventRequest'))})},
    '/v1/tasks/{taskId}/result':{post:op('submitPilotSuccess','Connector success subset: submit only after actual browser execution and stored screenshot. No fabricated evidence. Acknowledgement is not human acceptance. Retry only the same event and body.',{'200':success(ref('Acknowledgement'))},{parameters:[taskParameter],requestBody:body(ref('SuccessResult'))})},
    '/v1/pilot/tasks/{taskId}/artifact':{post:op('uploadPilotScreenshot','Raw actual screenshot, at most 2 MiB and dimensions at most 4096. Upload within current lease; keep event ID stable for identical retries.',{'201':success(ref('Artifact'))},{parameters:[taskParameter,{name:'X-Pilot-Lease-Id',in:'header',required:true,schema:id},{name:'X-Pilot-Attempt',in:'header',required:true,schema:attempt},{name:'X-Pilot-Event-Id',in:'header',required:true,schema:id}],requestBody:{required:true,content:{'image/png':{schema:{type:'string',format:'binary','x-max-bytes':2097152}},'image/jpeg':{schema:{type:'string',format:'binary','x-max-bytes':2097152}}}}})}
  };
  return {openapi:'3.0.3',...(servers?{servers}:{}),info:{title:'ChunLACK Public Browser Pilot',version:'1.0.0',description:'Private collaboration browser tasks only: no shell, admin, pairing, model API or automatic vendor Agent activation in this connector contract. Actual vendor compatibility still requires acceptance. Use only the operator-approved origin; never disable TLS validation.'},security:[{NodeBearer:[]}],paths,components:{securitySchemes:{NodeBearer:{type:'http',scheme:'bearer',description:'Dedicated pre-approved public node credential, supplied from secure storage. Never use an administrator credential.'}},schemas}};
}
module.exports={createPilotOpenApi};
