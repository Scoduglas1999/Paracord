# Incident Response Runbook

## Severity Levels
- `SEV-1`: Active compromise or widespread data exposure.
- `SEV-2`: Confirmed vulnerability with limited impact.
- `SEV-3`: Security weakness with no confirmed exploitation.

## First 15 Minutes
1. Declare incident level and open incident channel.
2. Freeze deployments and preserve logs/artifacts.
3. Assign incident commander, communications owner, and technical lead.
4. Start timeline with UTC timestamps.

## Playbook: Token Leakage
1. Rotate JWT secret and invalidate active sessions.
2. Force re-authentication.
3. Audit auth and admin endpoint logs for abuse window.
4. Publish impacted timeframe and remediation summary.

## Playbook: TLS Key Compromise
1. Revoke affected certificate immediately.
2. Generate new cert/key pair and deploy.
3. Enable strict HSTS enforcement verification post-rotation.
4. Confirm clients reconnect over trusted cert chain.

## Playbook: Federation Key Compromise
1. Disable federation ingest temporarily.
2. Rotate federation signing key and publish updated key metadata.
3. Reject events signed with retired keys after cutoff.
4. Reconcile suspicious events inserted during exposure window.

## Playbook: Emergency Patch
1. Branch from current release tag.
2. Implement minimal risk-contained fix.
3. Run security gate checks and targeted regression tests.
4. Release patched build and publish operator action steps.

## Post-Incident
1. Complete root-cause analysis within 5 business days.
2. Add regression test for exploit path.
3. Update threat model and remediation tracker.
4. Record preventive controls and owner/date commitments.
