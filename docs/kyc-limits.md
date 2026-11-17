# KYC rules and account limits

MOHAR does not open accounts or do KYC: the partner bank or wallet does, under its own State Bank
of Pakistan (SBP) licence. MOHAR receives the KYC level the partner assigned and enforces limits
for that level, so that gold cannot be used to get round them. This page says which SBP rules
the design follows, and what the demo only simulates.

**These are design references, not legal advice.** SBP changes its limits by circular, and
temporarily raises them (for example around Eid). Each partner must confirm the figures for its
own licence and product before any real customer uses MOHAR.

## Limits per KYC level

`KYC_LIMITS` in `api/.env` sets four limits per level, in PKR:
`level=perTrade:per24Hours:per30Days:maxHolding`.

| MOHAR level | Modelled on                         | Per trade | 24 hours  | 30 days    | Gold held up to |
| ----------- | ----------------------------------- | --------- | --------- | ---------- | --------------- |
| `asaan`     | Branchless banking Level 0 wallet   | 25,000    | 25,000    | 50,000     | 200,000         |
| `standard`  | Asaan Account (simplified due dil.) | 200,000   | 500,000   | 1,000,000  | 1,000,000       |
| `enhanced`  | Regular account, full CDD and EDD   | 2,500,000 | 5,000,000 | 20,000,000 | 50,000,000      |

- **Level 0:** a bank's published branchless-banking terms give Rs 25,000 a day, Rs 50,000 a
  month, Rs 200,000 a year and a Rs 200,000 maximum balance (ABL, branchless banking FAQs, 2021).
- **Asaan Account:** SBP raised the monthly debit limit and the maximum credit balance from
  Rs 0.5 million to Rs 1 million.
- **Enhanced:** SBP sets no cap for a fully verified regular account; these are the partner's
  own risk appetite and are placeholders.

What counts:

- Limits are on **money in**: purchases, and gold sent by another customer, valued at the price
  when it was sent. Without the second, one customer could buy up to their own limit and pass
  the gold to accounts with lower limits (structuring). Sales and transfers out are limited by
  the balance.
- Pending and confirmed credits count; failed ones never happened.
- "30 days" is a rolling window. SBP's monthly limits are per calendar month; rolling is the
  stricter reading.
- The holding limit uses the gold's value at the current price, plus the new credit.
- Each limit is checked when quoting and again, with nothing awaited in between, when the
  trade or transfer is recorded, so two requests sent together cannot both fit under a limit
  that only one of them fits.

## Opening an account (the partner's side, in `demo-bank`)

| Rule                                                                            | Source                             | Demo                                                                  |
| ------------------------------------------------------------------------------- | ---------------------------------- | --------------------------------------------------------------------- |
| One account per CNIC at each bank (Asaan Account; one digital account per CNIC) | SBP Asaan Account guidelines       | Enforced: keyed hash of the CNIC, per partner                         |
| Mobile number registered to the customer's own CNIC (CNIC–MSISDN pairing)       | SBP digital onboarding framework   | Enforced within the partner's own customers; operator check simulated |
| No account on an expired CNIC                                                   | SBP AML/CFT/CPF Regulations        | Enforced: expiry date, or "valid for life"                            |
| Customers aged 18 and over (minors have their own account types)                | SBP digital onboarding framework   | Enforced                                                              |
| NADRA verification (Verisys or biometric)                                       | SBP AML/CFT/CPF Regulations        | Simulated: typed details are taken as verified                        |
| Live photo / video KYC                                                          | SBP digital onboarding framework   | Not done: the photo is checked for type and size only                 |
| Sanctions and PEP screening; enhanced due diligence for high risk               | AML Act 2010 s.7A; SBP AML/CFT/CPF | Simulated lists; high risk is referred, not opened                    |
| Keep records; report suspicious transactions to the FMU                         | AML Act 2010; SBP AML/CFT/CPF      | Out of scope for the demo                                             |

The demo keeps no CNIC or mobile number: only masked forms for display, and HMAC fingerprints
under `CUSTOMER_HASH_SECRET` to detect a repeat.

## Sources

- SBP, Asaan Account: Guidelines on Low Risk Accounts with Simplified Due Diligence (BPRD
  Circular 11 of 2015): https://www.sbp.org.pk/bprd/2015/C11-Guidelines.pdf
- SBP, Customers' Digital Onboarding Framework (BPRD CL 15 of 2022):
  https://www.sbp.org.pk/bprd/2022/CL15-Annex.pdf
- SBP, AML/CFT/CPF Regulations for SBP's Regulated Entities:
  https://www.sbp.org.pk/bprd/2021/CL1-Annex-B.pdf
- SBP, Branchless Banking Regulations (BPRD Circular 10 of 2019):
  https://archive.sbp.org.pk/bprd/2019/C10.htm
- ABL, Branchless Banking FAQs (Level 0 and Level 1 limits), 2021:
  https://abl.com/wp-content/uploads/2023/01/FAQs-BB-10.11.2021.pdf
- Asaan Account limits raised to Rs 1 million (Zameen News, reporting the SBP circular):
  https://www.zameen.com/news/sbp-transaction-limit-asaan-accounts.html
