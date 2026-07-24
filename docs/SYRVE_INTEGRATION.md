# Syrve Cloud API integration

The Director-only connection wizard stores the Syrve API login encrypted on the backend and verifies access by requesting the available organizations.

## Required server setting

Set a strong secret before connecting Syrve:

```text
SYRVE_CREDENTIALS_SECRET=<strong-random-secret>
```

The value must be kept only in the server environment and must not be committed to the repository.

## Current scope

- Test API credentials.
- Select the Syrve organization.
- Store the API login encrypted with AES-256-GCM.
- Recheck and disconnect the integration.
- Record connection actions in the audit log.

Table, order and status synchronization remains disabled until the next integration stage.
