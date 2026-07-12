# Security Policy

KEEL executes developer-designated code locally and promises zero network egress (loopback inference excepted). Anything that violates those properties is a security bug of the highest severity — see the [threat model](docs/architecture/11-security.md).

## Reporting a vulnerability

Please report privately via [GitHub Security Advisories](https://github.com/Kaviselvaram/keel/security/advisories/new). Do not open public issues for vulnerabilities.

You can expect an acknowledgment within 7 days. Coordinated disclosure is appreciated; we will credit reporters in release notes unless you prefer otherwise.

## Scope notes

- KEEL does **not** claim to safely execute untrusted or malicious code; the sandbox contains accidents, not attacks ([Doc 11](docs/architecture/11-security.md), honesty statement).
- Any observed non-loopback network connection from KEEL is a vulnerability. Report it.
