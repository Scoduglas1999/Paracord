# Endpoint Security Checklist

Use this checklist for every new or changed backend endpoint before merge.

## Auth and Access Control
- [ ] Endpoint requires authentication unless explicitly public.
- [ ] Authorization is scoped to the target resource (guild/channel/user), not just role presence.
- [ ] Cross-tenant access is denied (cannot access another guild/DM/resource by ID guessing).
- [ ] Admin-only actions enforce admin/owner checks server-side.

## Input Validation
- [ ] All path/query/body fields are validated for type, range, and length.
- [ ] IDs are parsed safely and return `400` on malformed input.
- [ ] Text fields are checked for unsafe markup/scripts where rendered in UI.
- [ ] Pagination and bulk operations have strict max limits.

## Data Integrity
- [ ] Resource ownership is verified before update/delete/link actions.
- [ ] Foreign-key resource relationships are validated (e.g., message belongs to channel).
- [ ] Mutations are atomic or safely recoverable on partial failure.

## Output and Error Handling
- [ ] Response excludes secrets, hashes, tokens, and internal-only metadata.
- [ ] Errors use standardized envelope `{code,message,details}`.
- [ ] Permission failures use `403`, existence failures use `404`, invalid input uses `400`.
- [ ] No internal stack traces or SQL details are exposed in API responses.

## Eventing and Side Effects
- [ ] Gateway event payloads contain only required fields and no secrets.
- [ ] DM-scoped events dispatch only to participants.
- [ ] Auditable actions write security/audit logs where applicable.

## Operational Security
- [ ] Endpoint covered by at least one positive and one negative test.
- [ ] Rate-limiting/abuse posture reviewed for write-heavy endpoints.
- [ ] Files/uploads enforce MIME + magic-signature checks and size caps where applicable.
