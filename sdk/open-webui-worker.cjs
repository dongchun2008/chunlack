#!/usr/bin/env node
'use strict';
const os=require('node:os'),path=require('node:path');
const {AgentClient}=require('./agent-client.cjs');
const {loadCredentials}=require('./credentials.cjs');
const {createOpenWebUIHandler}=require('./adapters/open-webui.cjs');
async function main(){
  const env=process.env;
  if(!env.OPEN_WEBUI_URL||!env.OPEN_WEBUI_MODEL||!env.OPEN_WEBUI_API_KEY_FILE)throw new Error('missing_open_webui_configuration');
  const credentials=loadCredentials(env.LACK_NODE_CREDENTIALS_FILE||path.join(os.homedir(),'.chunlack','connector.json'));
  const handler=createOpenWebUIHandler({baseUrl:env.OPEN_WEBUI_URL,model:env.OPEN_WEBUI_MODEL,apiKeyFile:env.OPEN_WEBUI_API_KEY_FILE,allowLanHttp:env.OPEN_WEBUI_ALLOW_LAN_HTTP==='true'});
  const stop=new AbortController();process.once('SIGINT',()=>stop.abort());process.once('SIGTERM',()=>stop.abort());
  console.log('Open WebUI research node running in foreground; Ctrl+C stops it.');
  await new AgentClient(credentials).run(handler,{signal:stop.signal});
}
if(require.main===module)main().catch(()=>{console.error('Research node stopped: check private configuration, credentials, and endpoint availability.');process.exitCode=1;});
module.exports={main};
