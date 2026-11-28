# Justificatifs par e-mail

Le guide d'utilisation est sur le site : [Recevoir ses justificatifs par e-mail](https://www.kledg.com/fr/docs/saisie/recevoir-ses-justificatifs-par-e-mail). Cette page décrit le fonctionnement technique : configuration, webhook, sécurité et limites.

Chaque société peut avoir une adresse de justificatifs, `<jeton>@KLEDG_RECEIPTS_EMAIL_DOMAIN`. Une facture transférée à cette adresse, ou envoyée par un fournisseur qui l'a comme adresse de facturation, arrive parmi les justificatifs déposés de la page **Justificatifs**, lue et rapprochée comme un dépôt ([justificatifs-photo.md](justificatifs-photo.md)). Code : `lib/receipts/inbound`.

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
