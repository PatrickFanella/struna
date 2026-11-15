# ADR 0004: Voluntary support is a separate owner choice

Date: 2026-11-15. Issue: #86. Roadmap: #77.
Status: decided. The owner selected “Defer the support invitation for launch” on November 15, 2026. No payment destination is approved.

## Choice prepared for the owner

The launch invitation is deferred by owner decision. Revisit only after the owner supplies and approves a destination. Core practice, accounts and bring-your-own AI can proceed independently. A missing link must never become a placeholder payment URL or an invented recipient.

| Option | Fit | Work and unresolved facts |
| --- | --- | --- |
| Defer the invitation | Launch without asking for money; revisit once first-practice value is observed | No payment account, fees or financial promises; selected by the owner |
| External Patreon link | Fits ongoing support for Struna or the broader creator/studio work | Owner must choose recipient, exact URL and scope. The destination must clearly describe voluntary support without Struna feature entitlements. Patreon lists platform and processing fees; the actual account's plan has not been inspected |
| External Ko-fi tip page | Fits a simple optional tip to the selected creator | Owner must choose recipient and exact URL and approve its public wording. Ko-fi connects to the creator's PayPal or Stripe; no payment identity or account has been inspected |

Sources checked November 15, 2026: [Patreon creator fees](https://support.patreon.com/hc/en-us/articles/11111747095181-Creator-fees-overview) and [Ko-fi features](https://ko-fi.com/Features). These establish platform capabilities, not ownership of any particular page. No costs, returns or tax treatment are promised here.

## Exact proposed copy

If support is deferred, show no support entry or empty support screen.

For Struna-specific support, use the entry **Support Struna** and this explanation:

> If Struna helps you practise, you can choose to support its development. Support is voluntary and does not unlock app features or include AI usage. Your AI provider bills you separately. You can keep practising without paying.

For broader creator/studio support, use **Support the creator** and this explanation:

> You can choose to support the creator's work, including Struna. Support is voluntary and does not unlock app features or include AI usage. Your AI provider bills you separately. You can keep practising without paying.

The outgoing button says **Open Patreon** or **Open Ko-fi**, matching the selected destination. Do not display either until the actual link and recipient are verified. Do not describe tips as charitable donations, promise tax deductions, prices, trials, rewards, storage or priority access.

## Implementation handoff to #111

The selected outcome is no support entry at launch. #111 closes as not planned with this decision recorded. A future platform choice needs a new scoped issue, its exact public destination and approved copy. Verify the page belongs to the intended recipient and its terms agree with this copy; record the verification date. Put the entry in a quiet secondary place outside onboarding, active practice and review completion. Keep the destination external; send no account identifier, material name, practice content or analytics parameter. No payment SDK, webhook, entitlement or billing database belongs in #111.

The owner checkpoint in #86 (“Only the owner can choose the recipient, platform and financial promise”) is satisfied by the explicit deferral. Close #86 from its merged decision PR; no UI implementation or payment setup is needed. The proposed copy above is retained for a future comparison, not approved launch copy.
