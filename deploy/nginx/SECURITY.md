# Candidate Nginx security checks

The files here are candidate configuration, not evidence that production has changed. The current public API still runs the SQLite release until a separate supervised deployment.

Install `ai-video-security-headers.inc` at `/etc/nginx/conf.d/ai-video-security-headers.inc` in the Nginx container before installing `ai-video-ip.conf`. Run `nginx -t` inside that container, then reload and check the actual HTTPS response:

```sh
nginx -t
node deploy/nginx/verify-security-headers.mjs https://STAGING_ORIGIN
```

The checker covers `/`, `/studio/`, API JSON, an unauthorized object request, and a static 404. Set `AVS_TEST_OBJECT_ID` and `AVS_TEST_COOKIE` in the operator shell to include an authenticated object download; the checker does not print the cookie. Check the actual Nginx proxy peer seen by the API before setting `API_TRUSTED_PROXY_IPS`. The proxy must overwrite `X-Real-IP` and `X-Forwarded-For` with `$remote_addr`, as in this candidate.

The CSP is `Content-Security-Policy-Report-Only`. Review browser reports and valid Web/Studio resources before enforcing it. `X-Frame-Options: DENY` is active. HSTS is deliberately absent until the certificate, origin, IP/domain access policy, and rollback path have been verified. Do not add `includeSubDomains` for an IP-based site.

With server access, record redacted evidence for `nginx -t`, five route headers/statuses, container image digest/user/port bindings, private file modes, dependency/image scan version and findings, and SQLite DB/WAL/backup permissions. Run `bash deploy/security/check-candidate.sh` to check tracked credential-like paths and supplied private-file modes without showing file content. A local source check cannot prove the running Nginx or database state.
