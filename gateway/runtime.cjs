'use strict';
const path=require('node:path');const {once}=require('node:events');
async function startAgentGateway({config,dataRoot,identity,capacity,env=process.env,ready=()=>true}){
  const options=config.agentGateway;if(options?.enabled!==true)return null;
  if(!Number.isInteger(options.port)||options.port<1024||options.port>65535||typeof options.adminTokenEnv!=='string'||!/^[A-Z][A-Z0-9_]{1,100}$/.test(options.adminTokenEnv))throw new Error('invalid_gateway_configuration');
  const {createGatewayStore}=require('./store.cjs'),{createAgentGateway}=require('./server.cjs'),{createResearchBridge}=require('./research-bridge.cjs');
  // Construct HTTP validation before opening the persistent store.
  const token=env[options.adminTokenEnv];if(typeof token!=='string'||token.length<43||token.length>256)throw new Error('gateway_admin_credential_missing');
  const multiUser=config.multiUser?.enabled===true||env.LACK_MULTI_USER==='1';if(multiUser&&!identity)throw new Error('workspace_identity_required');if(env.LACK_PUBLIC_MODE==='1'&&!multiUser)throw new Error('legacy_public_forbidden');
  if(multiUser&&!capacity)throw new Error('workspace_capacity_required');
  const store=createGatewayStore({dbPath:path.join(dataRoot,'db','agent-gateway.db'),multiUser,capacity});
  let gateway,bridge,pilot,artifacts;
  try{
    const workspaceAccess=multiUser?require('./workspace-access.cjs').createWorkspaceGatewayAccess({store,identity}):null;
    if(multiUser){artifacts=require('./pilot-artifacts.cjs').createPilotArtifacts({store,root:path.join(dataRoot,'artifacts','public-pilot')});pilot=require('./node-facade.cjs').createPilotNodeHandler({store,artifacts,workspaceAccess,publicOrigin:config.publicRuntime?.agentsOrigin,ready});}
    gateway=createAgentGateway({store,adminToken:token,workspaceAccess,ready,pilotHandler:pilot});bridge=createResearchBridge({store,workspaceAccess});
    gateway.server.listen(options.port,'127.0.0.1');await once(gateway.server,'listening');
    const stop=gateway.close;let closed=false;
    gateway.close=async()=>{if(closed)return;closed=true;bridge.close();pilot?.close();await stop();store.close();};
    gateway.workspaceAccess=workspaceAccess;gateway.artifacts=artifacts;gateway.dispatchResearchStage=bridge.dispatchResearchStage;return gateway;
  }catch(error){bridge?.close();pilot?.close();if(gateway)await gateway.close();store.close();throw new Error('gateway_start_failed');}
}
module.exports={startAgentGateway};
