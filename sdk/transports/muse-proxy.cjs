'use strict';
const http=require('node:http'),https=require('node:https'),tls=require('node:tls');
function failure(code){return new Error(code);}
function createMuseProxyTransport({proxyUrl,targetOrigin,ca,timeoutMs=40000}){
  let proxy,target;try{proxy=new URL(proxyUrl);target=new URL(targetOrigin);}catch{throw failure('invalid_proxy_configuration');}
  if(!['http:','https:'].includes(proxy.protocol)||proxy.pathname!=='/'||proxy.search||proxy.hash||target.protocol!=='https:'||target.username||target.password||target.pathname!=='/'||target.search||target.hash||!Number.isInteger(timeoutMs)||timeoutMs<50||timeoutMs>40000)throw failure('invalid_proxy_configuration');
  if(process.env.NODE_TLS_REJECT_UNAUTHORIZED==='0')throw failure('unsafe_tls_environment');
  return async function transport(value,options={}){
    let url;try{url=new URL(value);}catch{throw failure('target_origin_denied');}
    if(url.origin!==target.origin||url.username||url.password||url.hash)throw failure('target_origin_denied');
    const method=options.method||'GET',headers=new Headers(options.headers);
    if(!['GET','POST'].includes(method)||['host','connection','proxy-authorization','content-length','transfer-encoding'].some(h=>headers.has(h)))throw failure('unsupported_transport_request');
    const bytes=options.body===undefined?null:Buffer.isBuffer(options.body)?options.body:typeof options.body==='string'?Buffer.from(options.body):null;
    if(options.body!==undefined&&!bytes)throw failure('unsupported_transport_body');
    const limit=/^\/v1\/pilot\/tasks\/[A-Za-z0-9_-]+\/artifact$/.test(url.pathname)?2097152:262144;
    if(bytes&&bytes.length>limit)throw failure('transport_body_too_large');
    if(method==='GET'&&bytes)throw failure('unsupported_transport_body');
    if(options.signal?.aborted)throw failure('transport_aborted');
    return new Promise((resolve,reject)=>{
      let settled=false,request,connect,tunnel,secure;const agent=new https.Agent({keepAlive:false});
      const finish=(error,response)=>{if(settled)return;settled=true;clearTimeout(timer);options.signal?.removeEventListener('abort',abort);request?.destroy();connect?.destroy();secure?.destroy();tunnel?.destroy();agent.destroy();if(error)reject(error);else resolve(response);};
      const abort=()=>finish(failure('transport_aborted'));const timer=setTimeout(()=>finish(failure('transport_timeout')),timeoutMs);options.signal?.addEventListener('abort',abort,{once:true});
      agent.createConnection=(_,callback)=>{
        let returned=false;const done=(error,socket)=>{if(returned)return;returned=true;callback(error,socket);};
        const proxyHeaders={Host:target.hostname+':'+(target.port||'443')};
        if(proxy.username||proxy.password)proxyHeaders['Proxy-Authorization']='Basic '+Buffer.from(decodeURIComponent(proxy.username)+':'+decodeURIComponent(proxy.password)).toString('base64');
        connect=(proxy.protocol==='https:'?https:http).request({hostname:proxy.hostname,port:proxy.port||(proxy.protocol==='https:'?443:80),method:'CONNECT',path:target.hostname+':'+(target.port||443),headers:proxyHeaders,agent:false,...(proxy.protocol==='https:'?{ca,rejectUnauthorized:true}:{})});
        connect.on('error',()=>done(failure('proxy_connection_failed')));
        connect.on('connect',(response,socket,head)=>{
          tunnel=socket;if(settled){socket.destroy();return;}
          if(response.statusCode!==200||head.length){socket.destroy();done(failure('proxy_connection_failed'));return;}
          secure=tls.connect({socket,host:target.hostname,servername:require('node:net').isIP(target.hostname)?undefined:target.hostname,ca,rejectUnauthorized:true});
          secure.once('error',()=>done(failure('proxy_transport_failed')));
          secure.once('secureConnect',()=>{const error=tls.checkServerIdentity(target.hostname,secure.getPeerCertificate());if(error){done(failure('proxy_transport_failed'));secure.destroy();}else done(null,secure);});
        });connect.end();
      };
      if(bytes)headers.set('Content-Length',String(bytes.length));
      request=https.request(url,{method,headers:Object.fromEntries(headers),agent},response=>{
        if(response.statusCode>=300&&response.statusCode<400){finish(failure('redirect_denied'));return;}
        let count=0;const chunks=[];response.on('data',chunk=>{count+=chunk.length;if(count>2097152){finish(failure('transport_response_too_large'));return;}chunks.push(chunk);});
        response.on('error',()=>finish(failure('proxy_transport_failed')));
        response.on('end',()=>{if(settled)return;try{const status=response.statusCode,body=[204,205,304].includes(status)?null:Buffer.concat(chunks);const outHeaders={};for(const [name,value] of Object.entries(response.headers))if(value!==undefined)outHeaders[name]=Array.isArray(value)?value.join(', '):value;finish(null,new Response(body,{status,headers:outHeaders}));}catch{finish(failure('proxy_transport_failed'));}});
      });
      request.on('error',error=>finish(failure(['proxy_connection_failed','proxy_transport_failed'].includes(error.message)?error.message:'proxy_transport_failed')));request.end(bytes||undefined);
    });
  };
}
module.exports={createMuseProxyTransport};
