# Connexions bancaires

Le guide d'utilisation (choisir la méthode, étapes de connexion Qonto, Revolut et Ponto, compte 512, expiration de l'accès) est sur le site : [Connecter sa banque](https://www.kledg.com/fr/docs/connecter-sa-banque). Cette page décrit le fonctionnement technique : identifiants, données lues, règles des fournisseurs, synchronisation planifiée.

Kledg reçoit les opérations de quatre façons, combinables dans une même société (une connexion par fournisseur) :

| Banque | Connexion | Coût | Ce qu'il faut |
|---|---|---|---|
| Qonto | Directe (API Qonto) | Gratuit | La clé API de l'organisation |
| Revolut Business | Directe (API Revolut Business) | Gratuit, offre Grow, Scale ou Enterprise | Un accès administrateur à Revolut Business |
| Autres banques françaises | Ponto (Isabel Group) | Environ 4 € par compte et par mois, facturés par Ponto | Un compte Ponto à votre nom |
| Toute banque | Import de relevés (fichier) | Gratuit | Un export CSV, Excel, OFX ou camt.053 |

Code : `lib/banking/providers` (`qonto.ts`, `revolut`, `ponto`), `lib/banking/connections.service.ts`, `lib/banking/ponto-connection.service.ts`, `lib/banking/revolut-connection.service.ts`, `lib/banking/sync-banks.service.ts`, `lib/banking/store-synced-transactions.service.ts`, `lib/banking/sync-rules.ts` (dédoublonnage, connexion directe prioritaire, délai d'actualisation Ponto), `lib/banking/consent.ts` (expiration de l'accès), `lib/banking/credentials.ts` (chiffrement). API : `app/api/banking/*` (connexions, `ponto`, `revolut`, `revolut/authorize`, `revolut/callback`, `manual-accounts`, `accounts/sync`, `connections/[id]/refresh`). Droits : lecture `banking:read`, connexion et identifiants `banking:manage` (Administrateur), actualisation Ponto `banking:reconcile`.

Page : **Banque, Comptes bancaires, Connecter une banque**. Les identifiants (clé Qonto, clé privée et jeton Revolut, secret Ponto) sont chiffrés sur l'instance (`ENCRYPTION_KEY`, voir [Configuration](configuration.md)) (`SECRET_FIELDS` : `secretKey` Qonto, `clientSecret` Ponto, `privateKey` et `refreshToken` Revolut) et ne sont jamais réaffichés ni renvoyés par l'API. Chaque compte (IBAN) est associé à un compte comptable de banque (512) ; ses opérations s'y enregistrent. Une transaction du fournisseur n'est stockée qu'une fois par compte bancaire (unicité `bankAccountId` + `externalTransactionId`) : une synchronisation relancée ne crée rien deux fois.

## Qonto (directe)

Identifiant de l'organisation et clé secrète de l'API Qonto. Kledg lit les comptes, les opérations (avec leur statut Qonto : les opérations en attente sont affichées mais jamais comptabilisées), les relevés et les justificatifs.

## Revolut Business (directe)

L'API Revolut Business est incluse dans les offres **Grow, Scale et Enterprise**, pas dans l'offre Basic ([offres incluant l'API](https://help.revolut.com/en-US/business/help/integrating-with-external-apps/revolut-business-api/question-using-revolut-business-api/)).

- **Générer le certificat** crée une clé privée (chiffrée sur l'instance) et un certificat X.509 public, à déclarer dans Revolut Business avec l'URL de redirection `https://<votre instance>/api/banking/revolut/callback`, à l'identique. Revolut renvoie un client ID ; **Autoriser dans Revolut** lance le consentement (lecture seule) puis revient sur le callback.
- Kledg lit les comptes en euros actifs et les opérations terminées (`completed`) ; les opérations en attente, refusées ou annulées ne sont pas importées.
- L'autorisation dure **90 jours** (règle DSP2) : Kledg prévient 14 jours puis 3 jours avant, et **Autoriser de nouveau** la renouvelle.
- Bac à sable Revolut : `REVOLUT_ENVIRONMENT=sandbox`.

Référence : [Revolut Business API](https://developer.revolut.com/docs/business/business-api).

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

`GET /api/cron/sync-banks` synchronise chaque jour toutes les connexions actives (Qonto, Revolut, Ponto), avec l'en-tête `Authorization: Bearer $CRON_SECRET`. Sur Vercel, `vercel.json` la planifie déjà. L'ancien chemin `/api/cron/sync-qonto` reste valable.

### Société en lecture seule

Une société archivée, ou que la politique de l'instance met en lecture seule (abonnement impayé ou contrat terminé sur une offre hébergée), ne reçoit plus d'opérations : la synchronisation quotidienne la saute, et la synchronisation manuelle, la connexion d'une banque et l'outil MCP `sync_bank_data` n'appellent pas la banque. La page **Comptes bancaires** affiche « Synchronisation bancaire suspendue » avec la raison, et `get_bank_sync_status` la donne dans `syncPaused`. Rien n'est enregistré pendant la pause : la date de dernière synchronisation reste celle d'avant. Dès que la société redevient modifiable, la synchronisation reprend d'elle-même et lit les opérations depuis cette date, si bien que la période suspendue est rattrapée (dans la limite de l'historique que la banque met à disposition). Code : `lib/banking/sync-pause.ts`.

Kledg n'est affilié ni à Qonto, ni à Revolut, ni à Isabel Group (Ponto). Ce sont des marques de leurs titulaires respectifs.
