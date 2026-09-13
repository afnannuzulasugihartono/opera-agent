// Explicit opt-in manual login. This is not hosted transaction acceptance.
import { createOAuthProbe } from '../helpers/transaction-oauth-8d.mjs';
import { startOAuthListener } from '../helpers/transaction-oauth-listener-8d.mjs';

const probe=createOAuthProbe({publicKey:process.env.OPERA_8D_PUBLISHABLE_KEY});
const listener=startOAuthListener({probe});
const stop=()=>{listener.close();process.removeListener('SIGINT',stop);process.removeListener('SIGTERM',stop);};
process.once('SIGINT',stop);process.once('SIGTERM',stop);
listener.server.once('close',stop);
try {await listener.ready;}
catch {console.log('Local callback unavailable; no alternate port or client created.');process.exitCode=1;stop();}
