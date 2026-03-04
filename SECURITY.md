# Security Policy

ACARS is an open-source, decentralized simulation with Nostr-based identity and event storage. We take security and safety seriously.

## Security Status

**Last Security Audit:** 2026-03-04  
**Overall Security Posture:** 🟡 GOOD (7.5/10)  
**Known Vulnerabilities:** 3 HIGH, 5 MODERATE (dev dependencies only)  
**Critical Issues:** All previous critical vulnerabilities have been remediated ✅

See `SECURITY_AUDIT.md` for detailed findings.

## Reporting a Vulnerability

Please report security issues privately to:

- **Email:** opensource@anomalyco.com
- **PGP Key:** Available upon request

### What to Include

- A clear description of the issue
- Steps to reproduce
- Impact assessment (what could be exploited)
- Affected files/components (if known)
- Proof of concept (if available)
- Any suggested fixes or mitigations

### Response Timeline

- **Acknowledgment:** Within 72 hours
- **Initial Assessment:** Within 5 business days
- **Remediation Plan:** Within 10 business days (severity dependent)
- **Fix Deployment:** As soon as possible after validation

## Severity Classifications

### CRITICAL

- Complete bypass of game rules
- Asset theft or duplication
- Fund manipulation
- **Response Time:** Immediate

### HIGH

- Information disclosure of sensitive data
- Dependency vulnerabilities with known exploits
- Denial of service vulnerabilities
- **Response Time:** 24 hours

### MODERATE

- Missing defense-in-depth measures
- Resource exhaustion vulnerabilities
- Race conditions with user impact
- **Response Time:** 1 week

### LOW

- Best practice improvements
- Missing optional security headers
- Verbose error messages
- **Response Time:** Next release cycle

## Supported Versions

We support:

- Latest `main` branch
- Most recent tagged release
- Previous major version (security fixes only)

## Public Disclosure Policy

**DO NOT** disclose vulnerabilities publicly until:

1. We have acknowledged the the issue
2. A fix has been developed and tested
3. We have agreed on a disclosure timeline
4. Users have had time to update

### Coordinated Disclosure

We follow responsible disclosure practices:

- Initial report: Private (email)
- Acknowledgment: Within 72 hours
- Fix development: Collaborative (if desired)
- CVE assignment: If applicable
- Public disclosure: After fix is deployed + 14-day grace period

## Security Architecture

### Decentralized Design

ACARS uses a **fully client-authoritative** architecture:

- All game rules enforced client-side
- State derived from immutable Nostr event log
- No server-side validation (by design)
- Cryptographic signatures ensure authenticity

### Accepted Risks

The following are **architectural limitations** inherent in the decentralized design:

1. **Modified Clients:** A modified client can bypass validations
2. **History Rewriting:** NIP-33 replacement allows event overwriting
3. **Timeline Injection:** Payload values not recomputed from state
4. **Relay Manipulation:** No multi-relay consensus mechanism

**Mitigation:** Consider authoritative validation relay for competitive integrity.

### Security Features

✅ **Implemented:**

- Content Security Policy (CSP)
- Fixed-point arithmetic for finances
- Cryptographic signature verification
- Comprehensive input validation
- Checkpoint hash verification
- Marketplace price verification
- No XSS vectors
- No hardcoded secrets

⚠️ **Recommended:**

- Rate limiting for operations
- Resource exhaustion protection
- Additional security headers
- Production-aware logging

## Security Best Practices

### For Contributors

1. **Never commit secrets** - API keys, credentials, private keys
2. **Validate all inputs** - Type guards, sanitizers, range checks
3. **Use fixed-point arithmetic** - For all financial calculations
4. **No sensitive logging** - Remove/guard console.log in production
5. **Test edge cases** - Malformed data, concurrent operations
6. **Run security checks** - `pnpm audit`, code review

### For Users

1. **Verify URLs** - Only use official ACARS domains
2. **Secure your keys** - Protect your Nostr private key
3. **Review permissions** - Check NIP-07 extension permissions
4. **Report issues** - Report suspicious activity promptly

## Security Testing

All contributors should:

- Run `pnpm audit` before submitting PRs
- Test with malformed payloads
- Verify signature validation
- Test concurrent operations
- Check for information disclosure

## Incident Response

In case of a security incident:

1. Assess severity immediately
2. Contain affected features if critical
3. Communicate with users (if needed)
4. Develop and test fix
5. Deploy fix with monitoring
6. Conduct post-incident review

## Contact

- **Security Issues:** opensource@anomalyco.com
- **General Inquiries:** See repository issues/discussions
- **PGP Key:** Available upon request for sensitive disclosures

---

**Last Updated:** 2026-03-04
