# Account Coach state (#92)

Hosted conversations, messages and custom prompts use the verified workspace database. Host CLI provider IDs and attachment uploads are refused. Inference remains unavailable in the runtime; tests explicitly inject an offline delayed runner. No owner process, model login, image proxy or temporary attachment directory is reachable. Reconnection reads the account-owned conversation; it cannot resume a foreign provider thread.

An active reply has an account, session, conversation and abort controller. Logout/account rotation abort immediately; an expiry/disabled-account check also runs during replies. Disconnect aborts the reply. Deletion stops owned work and prevents its reply from recreating deleted messages. The browser retains its singleton draft across panels/stages, but clears messages/drafts/queue and aborts on account invalidation.

`server/auth/coach.test.ts` covers independent delayed replies, foreign history/rename/delete/send, custom prompt isolation, logout while streaming, history readback after reauthentication, disconnect, anonymous access, host-login denial and attachment denial. Full typecheck, test and build checks apply. Public hosted access remains disabled until #94; real inference, attachment support and plan Apply are separate work.
