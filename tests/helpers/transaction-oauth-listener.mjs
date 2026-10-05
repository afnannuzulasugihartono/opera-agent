// @last-edited: 2026-10-04 18:25 UTC+7.
// @title: transaction-oauth-listener-8d — oauth-listener-8d — Nondefault physical ports/windows are test injection only; CLI exposes.
// @state: add reviewed in-process SDK identity and status-only probe.
// @dependencies: node:http, transaction-oauth-8d.

import { createServer } from 'node:http';
import { parseLocalCallbackRequest } from './transaction-oauth.mjs';

// Nondefault physical ports/windows are test injection only; CLI exposes neither.

export function startOAuthListener({probe,write=console.log,listenPort=6276,timeoutMs=300000}) {
  if(!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>300000) throw new Error('LISTENER_WINDOW_INVALID');
  let stopped=false; let timer;
  const server=createServer({headersTimeout:5000,requestTimeout:5000},async(req,res)=>{
    res.setHeader('Cache-Control','no-store');
    res.setHeader('Content-Type','text/plain; charset=utf-8');
    res.setHeader('Referrer-Policy','no-referrer');
    res.setHeader('X-Content-Type-Options','nosniff');
    try {
      const result=await probe.consume(parseLocalCallbackRequest(req));
      res.end('OAuth connection test complete. No browser action or transaction approval.',close);
      const report={userEndpointVerified:result.userEndpointVerified===true,browserDispatchAllowed:false};
      if(result.signedClaimsVerified===true&&[200,401,503].includes(result.hostStatusHttpStatus)) {
        Object.assign(report,{signedClaimsVerified:true,hostStatusHttpStatus:result.hostStatusHttpStatus,
          hostIdentityAccepted:result.hostIdentityAccepted===true,hostDisabled:result.hostDisabled===true});
      }
      write(JSON.stringify(report));
    } catch(error) {
      const code=error.message;
      res.writeHead(code==='OAUTH_CALLBACK_INVALID'?400:409);
      const terminal=code==='OAUTH_DENIED'||code==='OAUTH_EXCHANGE_FAILED';
      res.end('OAuth callback not accepted. No browser action.',terminal?close:undefined);
      if(terminal) write('OAuth test did not complete; credentials and remote errors omitted.');
    }
  });
  server.maxHeadersCount=20;
  function close() {
    if(stopped) return; stopped=true; clearTimeout(timer); probe.close();
    server.close(); server.closeAllConnections();
  }
  const ready=new Promise((resolve,reject)=>{
    server.once('error',()=>{close();reject(new Error('LOCAL_CALLBACK_UNAVAILABLE'));});
    server.listen(listenPort,'127.0.0.1',()=>{
      timer=setTimeout(()=>{write('OAuth test expired.');close();},timeoutMs);
      write('Open this temporary URL manually in Opera; enter credentials only in the trusted OAuth page:');
      write(probe.authorizationUrl);
      write('Listener expires within five minutes; no token is written or printed.'); resolve();
    });
  });
  return {server,ready,close};
}
