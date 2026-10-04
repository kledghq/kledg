# Connexions bancaires

Kledg reçoit les opérations de vos comptes de trois façons, que vous pouvez combiner dans une même société (une connexion par fournisseur) :

| Banque | Connexion | Coût | Ce qu'il faut |
|---|---|---|---|
| Qonto | Directe (API Qonto) | Gratuit | La clé API de l'organisation |
| Revolut Business | Directe (API Revolut Business) | Gratuit, offre Grow, Scale ou Enterprise | Un accès administrateur à Revolut Business |
| Autres banques françaises | Ponto (Isabel Group) | Environ 4 € par compte et par mois, facturés par Ponto | Un compte Ponto à votre nom |
| Toute banque | Import de relevés (fichier) | Gratuit | Un export CSV, Excel, OFX ou camt.053 |

Tout se fait depuis **Banque, Comptes bancaires, Connecter une banque**. Les identifiants (clé Qonto, clé privée et jeton Revolut, secret Ponto) sont chiffrés sur votre instance (`ENCRYPTION_KEY`, voir [Configuration](configuration.md)) et ne sont jamais réaffichés.

Ensuite, associez chaque compte (IBAN) à son compte comptable de banque (classe 512) dans la liste des comptes : ses opérations y seront enregistrées.

## Qonto (directe)

1. Dans Qonto : Paramètres, Intégrations et partenaires, Clé API. Copiez l'identifiant et la clé secrète.
2. Dans Kledg : Connecter une banque, Qonto, collez les deux valeurs.

Kledg lit les comptes, les opérations (avec leur statut Qonto : les opérations en attente sont affichées mais jamais comptabilisées), les relevés et les justificatifs.

## Revolut Business (directe)

L'API Revolut Business est incluse dans les offres **Grow, Scale et Enterprise**, pas dans l'offre Basic ([offres incluant l'API](https://help.revolut.com/en-US/business/help/integrating-with-external-apps/revolut-business-api/question-using-revolut-business-api/)). Avec l'offre Basic, importez vos relevés Revolut (CSV ou OFX).

1. Dans Kledg : Connecter une banque, Revolut Business, **Générer le certificat**. Kledg crée une clé privée (chiffrée sur votre instance) et un certificat X.509 public.
2. Dans Revolut Business : Paramètres, API, Business API, ajoutez un certificat. Collez le certificat et l'URL de redirection affichée par Kledg (`https://<votre instance>/api/banking/revolut/callback`, à l'identique). Revolut affiche un identifiant client (client ID).
3. Dans Kledg : collez l'identifiant client et cliquez sur **Autoriser dans Revolut**. Revolut demande votre accord (lecture seule), puis revient sur Kledg.

Kledg lit les comptes en euros actifs et les opérations terminées (`completed`) ; les opérations en attente, refusées ou annulées ne sont pas importées. L'autorisation dure **90 jours** (règle DSP2) : Kledg prévient 14 jours puis 3 jours avant, et le bouton **Autoriser de nouveau** la renouvelle.

Pour tester avec le bac à sable Revolut : `REVOLUT_ENVIRONMENT=sandbox`.

Référence : [Revolut Business API](https://developer.revolut.com/docs/business/business-api).

## Autre banque : Ponto

Pour les banques sans connexion directe (BNP Paribas, Société Générale, Crédit Agricole, Crédit Mutuel, CIC, LCL, La Banque Postale, Banque Populaire, Caisse d'Epargne...), Kledg passe par [Ponto](https://myponto.com), agrégateur agréé du groupe Isabel. Vous ouvrez **votre propre compte Ponto** : aucun contrat avec Kledg, Ponto vous facture directement (14 jours d'essai, puis environ 4 € par compte bancaire et par mois).

1. Créez votre compte sur [Ponto](https://dashboard.myponto.com/).
2. Dans Ponto, reliez votre banque (authentification forte de la banque).
3. Dans Ponto, créez une **intégration personnalisée** (custom integration) nommée Kledg avec accès aux comptes. Ponto affiche un identifiant client et un secret client.
4. Dans Kledg : Connecter une banque, choisissez votre banque dans la liste, collez l'identifiant et le secret.

La liste des banques vient de Ponto, avec un niveau de maturité : stable, bêta ou expérimental. Gardez l'import de relevés sous la main pour une banque en bêta ou expérimentale.

Fonctionnement :

- Ponto actualise vos comptes auprès de la banque quatre fois par jour ; la synchronisation de Kledg lit ces données.
- Le bouton **Actualiser** demande à Ponto d'interroger la banque tout de suite. Les conditions de Ponto l'autorisent seulement quand vous êtes présent, avec votre adresse IP réelle, et au plus toutes les 5 minutes par compte : Kledg applique ces règles. La tâche planifiée ne le fait jamais.
- Seules les opérations comptabilisées par la banque sont importées. Ponto précise que les opérations en attente ne doivent pas servir à la comptabilité.
- L'accès à la banque dure 90 ou 180 jours selon la banque. Kledg prévient 14 jours puis 3 jours avant ; une fois expiré, le compte apparaît « à jour jusqu'au » la date d'expiration. Renouvelez l'accès dans Ponto, puis actualisez.

Si le même IBAN est relié à la fois en direct (Qonto ou Revolut) et via Ponto, Kledg garde la connexion directe : le compte Ponto apparaît « Synchronisé via Qonto » et n'importe plus rien.

Références : [intégrations personnalisées Ponto](https://documentation.myponto.com/custom-integrations), [API Ponto](https://documentation.myponto.com/api).

## Banque sans connexion : import de relevés

BoursoBank, Shine et toute autre banque : **Ajouter un compte bancaire** (nom, IBAN facultatif, compte comptable 512), puis importez ses relevés. Voir [Importer un relevé bancaire](importer-un-releve-bancaire.md).

## Synchronisation planifiée

`GET /api/cron/sync-banks` synchronise chaque jour toutes les connexions actives (Qonto, Revolut, Ponto), avec l'en-tête `Authorization: Bearer $CRON_SECRET`. Sur Vercel, `vercel.json` la planifie déjà. L'ancien chemin `/api/cron/sync-qonto` reste valable.

Kledg n'est affilié ni à Qonto, ni à Revolut, ni à Isabel Group (Ponto). Ce sont des marques de leurs titulaires respectifs.
