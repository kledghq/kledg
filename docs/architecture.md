# Architecture

## Vue d'ensemble

```
app/
  (auth)/          connexion, /setup, mot de passe oublié
  (account)/       pages hors société, même cadre que les sociétés : liste des sociétés, compte, instance
  (company)/[companyId]/   toute la comptabilité d'une société
  api/             routes HTTP (une par ressource), appelées par l'interface et par les clés API
components/
  ui/              primitives shadcn/ui
  features/        composants métier (écritures, banque, états...)
  layout/          cadre (app-shell), barres latérales, fil d'Ariane ; navigation dans nav-config.ts et settings-nav-config.ts
lib/
  accounting/      règles comptables, exercices, clôture
  reports/         bilan, compte de résultat, balances, FEC
  dashboard/       widgets du tableau de bord, leurs données et les dispositions par utilisateur (voir tableau-de-bord.md)
  pcg/             référentiel et contrôles PCG 2026
  banking/         connexions bancaires (Qonto, Revolut Business, Ponto, comptes manuels), import de relevés
  integrations/    synchronisation des intégrations bancaires
  mcp/             serveur MCP pour les assistants IA
  ai-access/       sociétés accessibles à chaque assistant et clé API
  instance/        politique de l'instance, points d'extension (voir extension-points.md)
  email/           envoi via Resend et gabarits
  rbac/            rôles par société
prisma/
  schema.prisma    modèle de données
  migrations/      migrations SQL, appliquées au build sur Vercel
```

## Principes

- **Une instance, plusieurs sociétés.** Chaque société est liée à une organisation Better Auth ; les membres y ont un rôle (`companyAdmin`, `accountant`, `viewer`). Les administrateurs de l'instance (`role = admin`) voient toutes les sociétés.
- **Pas d'inscription publique.** Le premier compte est créé sur `/setup` ; les suivants par un administrateur.
- **Portabilité.** PostgreSQL standard via `pg`, aucune API propriétaire indispensable : Vercel et Neon sont le chemin le plus simple, pas une obligation.
- **IA par MCP.** Kledg n'appelle aucun modèle. Les assistants (Claude, ChatGPT) travaillent sur la comptabilité via le serveur MCP (`lib/mcp`, `app/api/mcp`), avec les droits de l'utilisateur, limités aux sociétés choisies pour chaque connexion (`lib/ai-access`, contrôle unique dans `lib/mcp/company-access.ts`).
- **Montants.** Les calculs comptables sont arrondis au centime ; les contrôles PCG sont isolés dans `lib/pcg` avec leurs tests.
