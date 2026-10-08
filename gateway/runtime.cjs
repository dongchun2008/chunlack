'use strict';
const path=require('node:path');const {once}=require('node:events');
async function startAgentGateway({config,dataRoot,env=process.env}){
  const options=config.agentGateway;if(options?.enabled!==true)return null;
  if(!Number.isInteger(options.port)||options.port<1024||options.port>65535||typeof options.adminTokenEnv!=='string'||!/^[A-Z][A-Z0-9_]{1,100}$/.test(options.adminTokenEnv))throw new Error('invalid_gateway_configuration');
  const {createGatewayStore}=require('./store.cjs'),{createAgentGateway}=require('./server.cjs'),{createResearchBridge}=require('./research-bridge.cjs');
  // Construct HTTP validation before opening the persistent store.
  const token=env[options.adminTokenEnv];if(typeof token!=='string'||token.length<43||token.length>256)throw new Error('gateway_admin_credential_missing');
  const store=createGatewayStore({dbPath:path.join(dataRoot,'db','agent-gateway.db')});let gateway,bridge;
  try{
    gateway=createAgentGateway({store,adminToken:token});bridge=createResearchBridge({store});
    gateway.server.listen(options.port,'127.0.0.1');await once(gateway.server,'listening');
    const stop=gateway.close;let closed=false;
    gateway.close=async()=>{if(closed)return;closed=true;bridge.close();await stop();store.close();};
    gateway.dispatchResearchStage=bridge.dispatchResearchStage;return gateway;
  }catch(error){bridge?.close();if(gateway)await gateway.close();store.close();throw new Error('gateway_start_failed');}
}
module.exports={startAgentGateway};
