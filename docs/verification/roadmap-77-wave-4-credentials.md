# Account AI connection storage (#93)

Hosted storage accepts only an OpenAI API key and model. It cannot choose host CLI logins, device-code auth, alternate endpoints, private addresses, operator keys or another account's configuration. Responses expose connected/model/saved status only. Execution remains disabled until #97 wires the direct Responses adapter.

Keys use AES-256-GCM with a fresh nonce and authenticated account/provider/version identity. Ciphertext lives under the owning account's private directory, outside practice/materials/plan roots. The mode-600 master key lives in a separate mode-700 secrets directory. Missing initialized keys and malformed/substituted ciphertext fail closed; disconnect can clear an unreadable connection. Replacing or disconnecting cancels owned replies, clears provider resume threads and dismisses pending proposals. This is local disconnection, not provider-side API key revocation.

Scratch tests use random dummy values and an offline runner. They prove redaction, separate encrypted stores, cross-account ciphertext rejection, integrity failure, anonymous/forged-provider/private-endpoint denial, request cancellation on disconnect and that the other player's connection remains intact. No credential value is printed, no provider is contacted and no owner login is read. Public hosted activation still requires #94 and focused ownership review.
