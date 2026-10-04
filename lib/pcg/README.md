# Module PCG 2026

Contrôles de conformité au Plan Comptable Général 2026 utilisés par la saisie des écritures et les immobilisations.

```
lib/pcg/
├── principles/          # Image fidèle (Art. 121-1) et prudence (Art. 121-3), appelés par lib/accounting/validator.ts
├── assets/              # Coût d'entrée (Art. 213-1 s.) et plans d'amortissement (Art. 214-1 s.)
├── services/            # Création d'immobilisations avec avertissements PCG (app/api/fixed-assets)
├── reports/             # Validation de la structure des états (bilan, compte de résultat)
├── compliance-checker.ts  # Contrôle de conformité d'une écriture
├── rules-catalog.ts       # Catalogue des règles PCG
├── rules-extractor.ts     # Extraction des règles depuis le texte du PCG
├── gap-analysis.ts        # Analyse des écarts (scripts/check-pcg-compliance.ts)
└── __tests__/             # Tests unitaires
```

Les avertissements renvoient l'article du PCG concerné. Toute nouvelle règle doit être accompagnée d'un test et de sa source.
