# Council Validation for AD Artifacts and Machine Workflows

## Validate theories against collected artifacts

Before reporting an AD attack path proposed by a model, check the local BloodHound, LDAP, certificate-template, service, and task evidence. A theoretically valid GenericWrite, UPN, certificate, or delegation chain can be blocked by the actual ACL, EKU, identity mapping, or protected-account policy.

Fast checks:

- Effective owner and ACEs for every proposed directory write.
- Template enrollment rights, EKUs, issuance requirements, and policy-OID groups.
- Target account UPN and protected-group status.
- Kerberos time and required SPNs.
- Service/task identity, liveness, working directory, and writable consumers.
- Existing certificates/tickets by metadata only; keep secret material outside the briefing.

## Machine workflows can replace an interactive session

When a hypothesis expects an administrator session, examine trusted machine workflows instead: Windows Update, backup, deployment, monitoring, certificate enrollment, and scheduled maintenance. A client can authenticate to and execute content from a trusted service without an interactive administrator logon.

For an internal update-service hypothesis, require proof of:

1. Client policy and the exact trusted hostname.
2. DNS control or another authorized routing primitive.
3. A certificate trusted for that hostname when TLS is used.
4. A listener matching the real protocol/state transitions.
5. Client retrieval and benign execution evidence.

Do not over-focus the council on inert reporting APIs when the privileged consumer is a machine workflow.

## Briefing and output

Provide sanitized object relationships, version/build data, and failed-path evidence. Ask each lane for prerequisites, falsification tests, rollback, and confidence. Store target identifiers, credentials, hashes, certificates, tickets, and proof strings only in the engagement vault.
