# Connexions bancaires

Le guide d'utilisation (choisir la méthode, étapes de connexion Qonto, Revolut et Ponto, compte 512, expiration de l'accès) est sur le site : [Connecter sa banque](https://www.kledg.com/fr/docs/banque/connecter-sa-banque) ; pour Stripe, [Connecter Stripe](https://www.kledg.com/fr/docs/banque/connecter-stripe). Cette page décrit le fonctionnement technique : identifiants, données lues, règles des fournisseurs, synchronisation planifiée.

Kledg reçoit les opérations de cinq façons, combinables dans une même société (une connexion par fournisseur) :

| Banque | Connexion | Coût | Ce qu'il faut |
|---|---|---|---|
| Qonto | Directe (API Qonto) | Gratuit | La clé API de l'organisation |
| Revolut Business | Directe (API Revolut Business) | Gratuit, offre Grow, Scale ou Enterprise | Un accès administrateur à Revolut Business |
| Autres banques françaises | Ponto (Isabel Group) | Environ 4 € par compte et par mois, facturés par Ponto | Un compte Ponto à votre nom |
| Stripe (solde du compte de paiement) | Directe (API Stripe) | Gratuit | Une clé restreinte en lecture seule |
| Toute banque | Import de relevés (fichier) | Gratuit | Un export CSV, Excel, OFX ou camt.053 |

Code : `lib/banking/providers` (`qonto.ts`, `revolut`, `ponto`, `stripe`), `lib/banking/stripe-setup.service.ts`, `lib/banking/connections.service.ts`, `lib/banking/ponto-connection.service.ts`, `lib/banking/revolut-connection.service.ts`, `lib/banking/sync-banks.service.ts`, `lib/banking/store-synced-transactions.service.ts`, `lib/banking/sync-rules.ts` (dédoublonnage, connexion directe prioritaire, délai d'actualisation Ponto), `lib/banking/consent.ts` (expiration de l'accès), `lib/banking/credentials.ts` (chiffrement). API : `app/api/banking/*` (connexions, `ponto`, `revolut`, `revolut/authorize`, `revolut/callback`, `manual-accounts`, `accounts/sync`, `connections/[id]/refresh`). Droits : lecture `banking:read`, connexion et identifiants `banking:manage` (Administrateur), actualisation Ponto `banking:reconcile`.

Page : **Banque, Comptes bancaires, Connecter une banque**. Les identifiants (clé Qonto, clé privée et jeton Revolut, secret Ponto) sont chiffrés sur l'instance (`ENCRYPTION_KEY`, voir [Configuration](configuration.md)) (`SECRET_FIELDS` : `secretKey` Qonto et Stripe, `clientSecret` Ponto, `privateKey` et `refreshToken` Revolut) et ne sont jamais réaffichés ni renvoyés par l'API. Chaque compte (IBAN) est associé à un compte comptable de banque (512) ; ses opérations s'y enregistrent. Une transaction du fournisseur n'est stockée qu'une fois par compte bancaire (unicité `bankAccountId` + `externalTransactionId`) : une synchronisation relancée ne crée rien deux fois.

## Qonto (directe)

Identifiant de l'organisation et clé secrète de l'API Qonto. Kledg lit les comptes, les opérations (avec leur statut Qonto : les opérations en attente, refusées ou annulées sont affichées mais jamais comptabilisées, par aucun chemin (`lib/banking/postable.ts`) ; une opération comptabilisée que Qonto refuse ou annule ensuite est inscrite au journal d'audit et signalée par les contrôles de la déclaration de TVA et de la clôture), les relevés et les justificatifs.

## Revolut Business (directe)

L'API Revolut Business est incluse dans les offres **Grow, Scale et Enterprise**, pas dans l'offre Basic ([offres incluant l'API](https://help.revolut.com/en-US/business/help/integrating-with-external-apps/revolut-business-api/question-using-revolut-business-api/)).

- **Générer le certificat** crée une clé privée (chiffrée sur l'instance) et un certificat X.509 public, à déclarer dans Revolut Business avec l'URL de redirection `https://<votre instance>/api/banking/revolut/callback`, à l'identique. Revolut renvoie un client ID ; **Autoriser dans Revolut** lance le consentement (lecture seule) puis revient sur le callback.
- Kledg lit les comptes en euros actifs et les opérations terminées (`completed`) ; les opérations en attente, refusées ou annulées ne sont pas importées.
- L'autorisation dure **90 jours** (règle DSP2) : Kledg prévient 14 jours puis 3 jours avant, et **Autoriser de nouveau** la renouvelle.
- Bac à sable Revolut : `REVOLUT_ENVIRONMENT=sandbox`.

Référence : [Revolut Business API](https://developer.revolut.com/docs/business/business-api).

## Stripe (directe, solde du compte de paiement)

Une **clé restreinte** (`rk_live_…`) créée dans le Dashboard Stripe (Développeurs, Clés API) avec l'accès en **lecture** au solde (Balance). Kledg refuse la clé secrète du compte (`sk_live_…`), qui permet de payer et de virer : il n'a besoin que de lire. Stripe répond 401 à une clé inconnue et 403 à une clé sans le droit nécessaire ; Kledg l'explique en français ([clés restreintes](https://docs.stripe.com/keys/restricted-api-keys)).

- **Le solde Stripe est un compte**, un par devise du solde (`externalAccountId` = la devise, `EUR`), sans IBAN. Son solde est celui de Stripe, fonds disponibles et en attente ensemble ([objet Balance](https://docs.stripe.com/api/balance/balance_object)).
- **Compte comptable** : 517100 « Stripe » par défaut (PCG 517 « Autres organismes financiers », classe 51 : des fonds que la société peut virer, de la trésorerie), ou 467100 « Stripe » (PCG 467 « Divers comptes débiteurs et produits à recevoir » : une créance sur Stripe), au choix à la connexion (`Integration.config.balanceAccount`). Kledg le crée dans chaque exercice ouvert et y associe le compte en euros. Un compte dans une autre devise reste sans compte comptable : Kledg ne comptabilise pas une opération en devise depuis son montant (#131).
- **Une ligne par opération** : chaque mouvement du solde ([balance transaction](https://docs.stripe.com/api/balance_transactions/object)) est une ligne à son montant brut, à son jour (heure de Paris), et ses frais sont une ligne à part (`externalTransactionId` `txn_…:fee`). Un paiement de 120 € avec 2,05 € de frais donne un crédit de 120 € et un débit de 2,05 € : le compte bouge du net, comme le solde Stripe. C'est l'enregistrement « jour par jour, opération par opération » du PCG (art. 1031-2). Une ligne est comptabilisable dès qu'elle est dans le solde, même si ses fonds sont encore « en attente » chez Stripe : la vente a eu lieu.
- **Par virement** (au choix à la connexion, `Integration.config.granularity` = `payout`, par paiement par défaut) : Kledg lit les virements automatiques créés depuis la dernière synchronisation, puis les opérations que chacun a emportées (filtre `payout` de l'API, réservé aux virements automatiques). Elles sont additionnées par type d'opération, sens et mois : une ligne pour les paiements, une pour les frais, une pour les remboursements..., plus la ligne du virement, et le compte se solde à chaque virement. C'est la « récapitulation au moins mensuelle des totaux des opérations » du PCG (art. 1031-2) : une ligne ne couvre jamais deux mois, celles d'un mois antérieur au virement sont datées du dernier jour de leur mois, et le détail (identifiant, montant, jour de chaque opération) reste dans `providerData` et dans le rapport de rapprochement des virements de Stripe. Une opération pas encore virée n'a pas de ligne. Stripe ne détaille pas un virement instantané ou manuel : la synchronisation s'arrête avec un message ([rapprochement des virements](https://docs.stripe.com/reports/payout-reconciliation)). Le mode ne se change pas sur une connexion qui a des lignes : elles seraient comptées deux fois.
- **Type d'opération** : `stripe.charge`, `stripe.refund`, `stripe.payout`, `stripe.adjustment` (litiges)…, `stripe.fee` pour les frais sur une opération et les frais de conversion, `stripe.service_fee` pour les frais des logiciels Stripe (Billing, Radar, Stripe Tax). Les règles Stripe portent sur ce type, jamais sur le libellé.
- **Règles ajoutées à la connexion** (bibliothèque, catégorie « Stripe (compte connecté) », `lib/rules-library/catalog/stripe.ts`), en priorité 10 :

| Règle | Opérations | Écriture | TVA |
|---|---|---|---|
| Paiements reçus sur Stripe | `stripe.charge`, `stripe.payment` | 706 | Collectée à 20 % (CGI art. 278), suggestion à revoir |
| Remboursements Stripe | `stripe.refund`, `stripe.payment_refund` | 706 au débit | TVA collectée reprise, suggestion |
| Commissions Stripe | `stripe.fee` | 6278 | Aucune : services de paiement exonérés (CGI art. 261 C, 1°), facturés sans TVA |
| Frais des logiciels Stripe | `stripe.service_fee` | 6278 | Autoliquidée à 20 % (CGI art. 283, 2) |
| Virements du compte Stripe vers la banque | `stripe.payout` | 58 | Aucune |
| Virements Stripe reçus (compte Stripe connecté) | crédit bancaire « STRIPE » | 58 | Aucune |

Les frais et les virements sont appliqués sans clic (en brouillon), les ventes et les remboursements restent des suggestions : leur taux dépend de ce que la société vend. Le virement passe par 58 « Virements internes » des deux côtés (PCG art. 1215-58) : débit côté Stripe, crédit côté banque, et le 58 se solde. Une règle que la société a déjà (même nom ou mêmes conditions) est gardée et signalée : une règle « Virements Stripe » qui passe le virement en 467 passerait chaque virement deux fois, en 58 côté Stripe et en 467 côté banque. Stripe facture ses frais sans TVA aux comptes de l'Union européenne hors Irlande ([taxes sur les frais Stripe](https://support.stripe.com/questions/taxation-of-stripe-fees)).

Référence : [API Stripe, balance transactions](https://docs.stripe.com/api/balance_transactions/list).

## Autre banque : Ponto

Pour les banques sans connexion directe, Kledg passe par [Ponto](https://myponto.com), agrégateur agréé du groupe Isabel. Le compte Ponto est celui de l'utilisateur (aucun contrat avec Kledg), avec une **intégration personnalisée** (custom integration) ayant accès aux comptes ; Kledg reçoit son identifiant client et son secret client. La liste des banques vient de Ponto, avec un niveau de maturité : stable, bêta ou expérimental.

- Ponto actualise les comptes auprès de la banque quatre fois par jour ; la synchronisation de Kledg lit ces données.
- Le bouton **Actualiser** demande à Ponto d'interroger la banque tout de suite. Les conditions de Ponto l'autorisent seulement quand l'utilisateur est présent, avec son adresse IP réelle, et au plus toutes les 5 minutes par compte (`PONTO_REFRESH_INTERVAL_MS`) : Kledg applique ces règles. La tâche planifiée ne le fait jamais.
- Seules les opérations comptabilisées par la banque sont importées. Ponto précise que les opérations en attente ne doivent pas servir à la comptabilité.
- L'accès à la banque dure 90 ou 180 jours selon la banque. Kledg prévient 14 jours puis 3 jours avant (`CONSENT_WARNING_DAYS`, `CONSENT_URGENT_DAYS`, date `authorizationExpirationExpectedAt` de Ponto) ; une fois expiré, le compte apparaît « à jour jusqu'au » la date d'expiration jusqu'au renouvellement dans Ponto.

Si le même IBAN est relié à la fois en direct (Qonto ou Revolut) et via Ponto, Kledg garde la connexion directe : le compte Ponto pointe vers le compte direct (`supersededById`), apparaît « Synchronisé via Qonto » et n'importe plus rien.

Références : [intégrations personnalisées Ponto](https://documentation.myponto.com/custom-integrations), [API Ponto](https://documentation.myponto.com/api).

## Banque sans connexion : import de relevés

Un compte ajouté par **Ajouter un compte bancaire** (nom, IBAN facultatif, compte comptable 512) reçoit ses opérations par import. Voir [Importer un relevé bancaire](importer-un-releve-bancaire.md).

## Synchronisation planifiée

`GET /api/cron/sync-banks` synchronise chaque jour toutes les connexions actives (Qonto, Revolut, Ponto, Stripe), avec l'en-tête `Authorization: Bearer $CRON_SECRET`. Sur Vercel, `vercel.json` la planifie déjà. L'ancien chemin `/api/cron/sync-qonto` reste valable.

### Société en lecture seule

Une société archivée, ou que la politique de l'instance met en lecture seule (abonnement impayé ou contrat terminé sur une offre hébergée), ne reçoit plus d'opérations : la synchronisation quotidienne la saute, et la synchronisation manuelle, la connexion d'une banque et l'outil MCP `sync_bank_data` n'appellent pas la banque. La page **Comptes bancaires** affiche « Synchronisation bancaire suspendue » avec la raison, et `get_bank_sync_status` la donne dans `syncPaused`. Rien n'est enregistré pendant la pause : la date de dernière synchronisation reste celle d'avant. Dès que la société redevient modifiable, la synchronisation reprend d'elle-même et lit les opérations depuis cette date, si bien que la période suspendue est rattrapée (dans la limite de l'historique que la banque met à disposition). Code : `lib/banking/sync-pause.ts`.

Kledg n'est affilié ni à Qonto, ni à Revolut, ni à Isabel Group (Ponto), ni à Stripe. Ce sont des marques de leurs titulaires respectifs.
