# Justificatifs par e-mail

Le guide d'utilisation est sur le site : [Recevoir ses justificatifs par e-mail](https://www.kledg.com/fr/docs/saisie/recevoir-ses-justificatifs-par-e-mail). Cette page décrit le fonctionnement technique : configuration, webhook, sécurité et limites.

Deux façons de recevoir des justificatifs par e-mail : une adresse de justificatifs propre à Kledg, `<jeton>@KLEDG_RECEIPTS_EMAIL_DOMAIN` (ci-dessous), ou une [boîte e-mail](#boîte-e-mail) de la société que Kledg relève en IMAP. Chaque société peut avoir l'une, l'autre ou les deux. Une facture transférée à cette adresse, ou envoyée par un fournisseur qui l'a comme adresse de facturation, arrive parmi les justificatifs déposés de la page **Justificatifs**, lue et rapprochée comme un dépôt ([justificatifs-photo.md](justificatifs-photo.md)). Code : `lib/receipts/inbound`.

## Configuration

L'exploitant choisit un domaine (de préférence un sous-domaine dédié, `justificatifs.example.fr`) et un fournisseur d'e-mails entrants, qui reçoit le courrier du domaine (ses enregistrements MX) et l'envoie à Kledg. Sans domaine ou sans fournisseur, la fonction est absente : la carte ne s'affiche pas et le webhook répond 404.

| Fournisseur | Webhook | Preuve vérifiée | Variables |
| --- | --- | --- | --- |
| Resend | événement `email.received` vers `/api/inbound-email/resend` | signature Svix (`svix-id`, `svix-timestamp`, `svix-signature`) : HMAC-SHA256 en base64 de `id.timestamp.corps brut`, clé = partie base64 du secret après `whsec_`, 5 minutes de tolérance ([Svix](https://docs.svix.com/receiving/verifying-payloads/how-manual)) | `RESEND_INBOUND_WEBHOOK_SECRET`, `RESEND_API_KEY` |
| Postmark | webhook entrant du flux Inbound vers `https://kledg:<mot de passe>@instance/api/inbound-email/postmark` | mot de passe de l'authentification de base : Postmark ne signe pas ses webhooks ([Postmark](https://postmarkapp.com/developer/webhooks/webhooks-overview)) | `POSTMARK_INBOUND_PASSWORD` |
| Mailgun | route avec l'action `forward()` vers `/api/inbound-email/mailgun` (formulaire, pas JSON) | HMAC-SHA256 en hexadécimal de `timestamp` + `token` avec la clé de signature des webhooks, 5 minutes de tolérance ([Mailgun](https://documentation.mailgun.com/docs/mailgun/user-manual/webhooks/securing-webhooks)) | `MAILGUN_WEBHOOK_SIGNING_KEY` |

Resend n'envoie que les métadonnées : Kledg liste les pièces jointes par l'API (`GET /emails/receiving/{id}/attachments`) et télécharge chacune par son lien signé, valable une heure, sans envoyer sa clé ([Resend](https://resend.com/docs/dashboard/receiving/attachments)). Postmark et Mailgun envoient les pièces jointes avec l'e-mail : sur Vercel, une requête est limitée à 4,5 Mo, et seul Resend convient aux pièces jointes plus lourdes.

## L'adresse

- Le jeton est aléatoire, 16 caractères parmi 36 (environ 82 bits, `lib/receipts/inbound/address.ts`), unique (`companies.receiptInboxToken`, contrainte de forme `companies_receipt_inbox_token_check`). L'adressage « plus » est accepté (`jeton+ovh@domaine`).
- Qui connaît l'adresse peut envoyer des justificatifs à la société : c'est le but (un fournisseur y envoie ses factures). Elle n'est montrée qu'aux membres qui rapprochent la banque (`banking:reconcile`), et un administrateur (`settings:update`) la crée ou la change (`POST /api/receipts/inbox`) : l'ancienne ne reçoit plus rien, aussitôt. Ni l'une ni l'autre route n'est exposée aux assistants (MCP).

## Réception

`POST /api/inbound-email/[provider]` (`lib/receipts/inbound/handle-webhook.ts`), sans session :

1. 404 si la fonction ou ce fournisseur n'est pas configuré ; 401 si la preuve manque ou est fausse ; 413 au-delà de 75 Mo.
2. L'e-mail est lu en une forme commune (`adapters.ts`) : ses destinataires (To, Cc, Bcc, destinataire d'origine), ses pièces jointes, son identifiant, son expéditeur et son objet pour le journal d'audit. Le corps et ses liens ne sont jamais lus.
3. La société est trouvée par le jeton du premier destinataire qui est une adresse de l'instance, dans un contexte système (`receipt-email`, [rls.md](rls.md)), puis tout se passe dans un contexte limité à cette société. Un e-mail à aucune adresse, ou à une ancienne adresse, est accepté (200) et ignoré : le fournisseur ne réessaie pas pour rien.
4. Chaque pièce jointe (10 au plus par e-mail) qui n'est pas une image intégrée au corps (un logo de signature) est déposée comme un justificatif (`stageReceipt`, source `email`) : type lu dans les octets (JPEG, PNG ou PDF), 5 Mo au plus, une seule fois par contenu (SHA-256). Une autre pièce (un .docx, une invitation) est ignorée. Le justificatif n'a pas de déposant : seuls les membres qui classent les justificatifs de tous (`banking:reconcile`, `expenses:validate`) le voient.
5. Chaque justificatif est lu (facture électronique, texte du PDF, [justificatifs-photo.md](justificatifs-photo.md)), puis sa transaction cherchée : trouvée, elle devient sa suggestion (`suggestedTransactionId`), qu'un membre rattache d'un clic. **Rien n'est rattaché ni comptabilisé sans un membre.**
6. 200 avec le nombre de justificatifs déposés, déjà connus et ignorés. Une erreur de Kledg répond 500 : le fournisseur réessaie, et déposer de nouveau les mêmes fichiers ne change rien.

## Limites

- 300 justificatifs reçus par e-mail par société et par jour (`receipt-email`, `lib/rate-limit.ts`) : au-delà, les pièces suivantes sont ignorées et l'e-mail est noté en avertissement dans le journal d'audit.
- Un justificatif non classé est supprimé au bout de 30 jours, comme tout justificatif déposé.
- Une facture dans le corps de l'e-mail (HTML), sans pièce jointe, n'est pas reprise.

## Boîte e-mail

Une boîte e-mail de la société (la sienne, chez n'importe quel hébergeur) que Kledg relève en IMAP, sans domaine ni fournisseur à configurer par l'exploitant (`lib/receipts/mailbox`). Disponible sur toute instance.

- **Connexion** : serveur, identifiant et mot de passe (ou mot de passe d'application : Gmail, iCloud), saisis par un administrateur (`settings:update`) dans **Banque**, **Justificatifs**. Kledg se connecte et vérifie le dossier avant d'enregistrer (`PUT /api/receipts/mailbox`, `POST /api/receipts/mailbox/folders`). La boîte est une intégration (`provider` IMAP, `type` RECEIPTS) : le serveur et l'identifiant en clair, le mot de passe chiffré avec la clé de l'instance (`lib/banking/credentials.ts`), jamais réaffiché, et jamais envoyé à un autre serveur ou un autre identifiant que ceux avec lesquels il a été saisi.
- **Sécurité de la connexion** (`imap-client.ts`, imapflow) : TLS dès le premier octet, port 993 seulement (IMAPS, RFC 8314), certificat vérifié pour le nom du serveur, TLS 1.2 au moins ; connexion seulement à une adresse publique, vérifiée dans la résolution du socket (`publicOnlyLookup`, comme les fichiers Qonto) : un serveur qui se résout en adresse locale, privée ou de métadonnées cloud est refusé, rebinding DNS compris. Délais bornés (connexion 15 s, accueil 10 s, socket 60 s) et littéraux IMAP bornés à la taille d'un justificatif.
- **Lecture** (`readMailbox`) : un seul dossier, choisi à la connexion (une boîte ou un dossier réservé aux factures est conseillé : Kledg lit les pièces jointes de chaque message qui y arrive). Kledg lit la structure MIME du message (`BODYSTRUCTURE`) et ne télécharge que les pièces jointes, jamais le corps ; les images intégrées (logos) sont ignorées, les pièces d'un message transféré sont reprises. Chaque message passe ensuite par la même réception que l'adresse de justificatifs (`receiveEmailForCompany`, source `imap` dans le journal d'audit) : 10 pièces au plus, types lus dans les octets, limite quotidienne de la société, justificatifs lus et rapprochés en suggestions, jamais rattachés.
- **Deux modes**, au choix à la connexion :
  - **lecture seule** (par défaut) : rien n'est modifié dans la boîte ; Kledg retient le dernier message lu (UID et UIDVALIDITY, RFC 3501 2.3.1.1). La première relève prend les messages des 30 derniers jours ; un autre UIDVALIDITY (dossier renuméroté par le serveur) fait relire les 30 derniers jours, sans déposer deux fois un même fichier ;
  - **déplacement** : chaque message lu est déplacé dans un dossier (`Kledg/Traités` par défaut, créé au besoin), et le dossier lu ne garde que ce qui reste à lire.
- **Quand** : chaque nuit, après la synchronisation bancaire (`/api/cron/sync-banks` ; sans `CRON_SECRET`, seulement les boîtes non relevées depuis 20 heures), et sur demande (« Relever maintenant », `POST /api/receipts/mailbox/read`, `banking:reconcile`, 20 connexions par société et 10 minutes, `mailbox-connect`). 100 messages au plus par relève, la suite à la suivante. Une relève qui échoue garde sa raison en français (mot de passe refusé, serveur introuvable, port 993 fermé, certificat invalide), affichée sur la carte ; la boîte reste relevée chaque nuit.
- **Limite** : la connexion par mot de passe. Microsoft 365 n'accepte plus de mot de passe en IMAP ; la connexion OAuth (Google, Microsoft) suit dans une prochaine version.
