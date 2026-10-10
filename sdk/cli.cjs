#!/usr/bin/env node
'use strict';
const path=require('node:path');const os=require('node:os');const readline=require('node:readline');
const {AgentClient,validateBaseUrl}=require('./agent-client.cjs');const {saveCredentials,loadCredentials}=require('./credentials.cjs');
const {pairingArgs,bindingFromPairing,pairingRoute}=require('./pairing.cjs');
function hiddenInput(prompt){
  if(!process.stdin.isTTY)throw new Error('Pairing needs an interactive terminal; use the SDK for automation');
  process.stdout.write(prompt);return new Promise(resolve=>{let value='';readline.emitKeypressEvents(process.stdin);process.stdin.setRawMode(true);process.stdin.resume();const listener=(text,key)=>{if(key?.ctrl&&key.name==='c'){cleanup();process.exitCode=130;resolve('');}else if(key?.name==='return'){cleanup();resolve(value);}else if(key?.name==='backspace')value=value.slice(0,-1);else if(text&&!key?.ctrl)value+=text;};function cleanup(){process.stdin.off('keypress',listener);process.stdin.setRawMode(false);process.stdin.pause();process.stdout.write('\n');}process.stdin.on('keypress',listener);});
}
async function main(){
  const args=process.argv.slice(2),command=args.shift();const file=path.join(os.homedir(),'.chunlack','connector.json');
  if(command==='pair'){
    const {baseUrl,workspaceId}=pairingArgs(args),code=await hiddenInput('一次性配对码（输入不显示）：');if(!code)return;
    const client=new AgentClient({baseUrl,workspaceId});const value=await client.request(pairingRoute({workspaceId}),{method:'POST',body:{code}});
    saveCredentials(file,{baseUrl,...bindingFromPairing(value,{workspaceId})});console.log('已配对，节点凭据已保护保存。');return;
  }
  const value=loadCredentials(file),client=new AgentClient(value);
  if(command==='status'&&args.length===0){const state=await client.status();console.log(JSON.stringify(state,null,2));return;}
  if(command==='run'&&args.join(' ')==='--fixture'){
    const cancellation=new AbortController();const stop=()=>cancellation.abort();process.once('SIGINT',stop);process.once('SIGTERM',stop);console.log('模拟节点已启动。按 Ctrl+C 停止。');await client.run(require('./fixtures/research-worker.cjs').handler,{signal:cancellation.signal});return;
  }
  throw new Error('Usage: pair <gateway-origin> [--workspace <approved-id>] | status | run --fixture. Public ingress permits only scoped one-time pairing; real agents use AgentClient.run with a trusted handler.');
}
if(require.main===module)main().catch(()=>{console.error('连接器操作失败。请检查私有地址、配对有效期和节点权限；凭据不会输出。');process.exitCode=1;});
module.exports={main};
