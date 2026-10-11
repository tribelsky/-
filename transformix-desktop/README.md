# Transformix Desktop 0.1

Windows desktop shell for the Transformix ecosystem.

## What is operational in 0.1
- Local folder selection.
- Read-only project scan.
- Seven report categories: Structure, Data, Exposure, Product Reality, Dependencies, Readiness, Repair/Upgrade.
- Plutox rule-based route selection with safe `NO_PLAN` on potential secret exposure.
- SpiderEye initial structure/dependency map.
- Evidence fingerprint and JSON export.
- DINGO bounded action: creates a sandbox copy only; source files are not written.
- Controlled Skill manifest composer.
- Agent Genome / derived reorientation manifest lab.
- Ghost Sentinel synthetic trace pattern lab.

## Claim boundaries
The product UI preserves evidence classes. A working local scan is not a claim of semantic correctness, production safety, arbitrary autonomous evolution, arbitrary agent transformation, or open-world malicious intent detection.

## Run
```bash
npm install
npm start
```

## Test
```bash
npm test
```

## Windows build
```bash
npm run dist
```
Produces an NSIS installer and portable Windows executable.