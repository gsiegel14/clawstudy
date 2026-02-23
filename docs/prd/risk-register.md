# Risk Register

Last updated: February 23, 2026

| ID | Risk | Likelihood | Impact | Mitigation | Owner | Status |
|---|---|---|---|---|---|---|
| R-01 | ACEP credential leakage | Low | Critical | Enforce local-only credential boundary and no cloud storage | Gabe | Open |
| R-02 | Messaging outages | Medium | High | Retry queue, fallback channel, cached session plan | Gabe | Open |
| R-03 | Low-quality generated questions | Medium | High | Quality scoring, review queue, source citation checks | Gabe | Open |
| R-04 | Budget overrun | Medium | High | Hard spend caps, warning alerts, fallback low-cost mode | Gabe | Open |
| R-05 | Incomplete daily adherence | Medium | High | Fixed schedule, adaptive reminders, short session option | Gabe | Open |
| R-06 | Schema drift during rapid iteration | Medium | Medium | Versioned contracts and migration tests | Gabe | Open |
| R-07 | Backup restore failure | Low | Critical | Weekly restore tests and verification checks | Gabe | Open |
