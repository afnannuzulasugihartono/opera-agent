// @last-edited: 2026-10-04 18:25 UTC+7.
// @title: transaction-oauth-login-8d — oauth-login-8d — Explicit opt-in manual login. This is not hosted transaction acceptance.
// @state: add independently reviewed bounded manual OAuth probe for.
// @dependencies: transaction-oauth-8d, transaction-oauth-listener-8d.

// Explicit opt-in manual login. This is not hosted transaction acceptance.

import { createOAuthProbe } from '../helpers/transaction-oauth.mjs';
import { startOAuthListener } from '../helpers/transaction-oauth-listener.mjs';

const probe=createOAuthProbe({publicKey:process.env.OPERA_PUBLISHABLE_KEY});
const listener=startOAuthListener({probe});
const stop=()=>{listener.close();process.removeListener('SIGINT',stop);process.removeListener('SIGTERM',stop);};
process.once('SIGINT',stop);process.once('SIGTERM',stop);
listener.server.once('close',stop);
try {await listener.ready;}
catch {console.log('Local callback unavailable; no alternate port or client created.');process.exitCode=1;stop();}
