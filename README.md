<p align="center">
  <a href="https://www.kledg.com"><img src="public/logo.svg" width="56" height="56" alt="Kledg" /></a>
</p>

<h1 align="center">Kledg</h1>

<p align="center">
  Le logiciel comptable gratuit pour produire votre bilan et votre compte de résultat chaque année.<br />
  <sub>Open-source accounting for French companies (PCG 2026), self-hosted on Vercel and Neon.</sub>
</p>

<p align="center">
  <a href="https://www.kledg.com">Site</a> ·
  <a href="https://www.kledg.com/auto-hebergement">Auto-hébergement</a> ·
  <a href="docs/README.md">Documentation</a> ·
  <a href="CONTRIBUTING.md">Contribuer</a>
</p>

---

Kledg tient la comptabilité générale des petites sociétés françaises (SASU, EURL, SARL, SAS, SCI à l'IS, holdings) : plan comptable PCG 2026, saisie et import d'écritures, banque et rapprochement, immobilisations, clôture, bilan, compte de résultat et export FEC. Il est gratuit et open source : vous le déployez vous-même, vos données restent dans votre base PostgreSQL.

Et votre assistant IA peut y travailler : chaque instance expose un **serveur MCP** pour connecter Claude ou ChatGPT à votre comptabilité ([docs/mcp.md](docs/mcp.md)).

## Déployer en un clic

[![Déployer sur Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fkledghq%2Fkledg&project-name=kledg&repository-name=kledg&env=BETTER_AUTH_SECRET%2CADMIN_EMAIL&envDescription=BETTER_AUTH_SECRET%20%3A%20un%20secret%20al%C3%A9atoire%20%28bouton%20G%C3%A9n%C3%A9rer%20sur%20la%20page%20li%C3%A9e%29.%20ADMIN_EMAIL%20%3A%20votre%20email%2C%20qui%20recevra%20le%20lien%20de%20cr%C3%A9ation%20du%20compte%20administrateur.&envLink=https%3A%2F%2Fwww.kledg.com%2Ffr%2Fdocs%2Finstaller-kledg%23d%C3%A9ployer-sur-vercel&stores=%5B%7B%22type%22%3A%22integration%22%2C%22integrationSlug%22%3A%22neon%22%2C%22productSlug%22%3A%22neon%22%2C%22protocol%22%3A%22storage%22%7D%2C%7B%22type%22%3A%22integration%22%2C%22integrationSlug%22%3A%22resend%22%2C%22productSlug%22%3A%22resend-email%22%2C%22protocol%22%3A%22messaging%22%7D%5D&demo-title=Kledg&demo-description=La%20comptabilit%C3%A9%20fran%C3%A7aise%20open%20source%20de%20votre%20soci%C3%A9t%C3%A9%2C%20avec%20un%20serveur%20MCP%20pour%20Claude%20et%20ChatGPT.&demo-url=https%3A%2F%2Fdemo.kledg.com&demo-image=https%3A%2F%2Fwww.kledg.com%2Ffr%2Fopengraph-image&redirect-url=https%3A%2F%2Fwww.kledg.com%2Ffr%2Fwelcome)

Le bouton crée le projet Vercel, provisionne une base **Neon** et un compte **Resend**, et ne demande que `BETTER_AUTH_SECRET` et `ADMIN_EMAIL`. Au premier déploiement, les migrations s'appliquent automatiquement ; ouvrez ensuite `/setup` sur votre instance : elle envoie à `ADMIN_EMAIL` le lien qui crée le compte administrateur.

### Autres hébergeurs

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/kledghq/kledg)

| Hébergeur | Fichier | Guide |
| --- | --- | --- |
| Render | `render.yaml` (bouton ci-dessus) | [Render](docs/self-hosting.md#render) |
| Railway | `railway.json` | [Railway](docs/self-hosting.md#railway) |
| Fly.io | `fly.toml` | [Fly.io](docs/self-hosting.md#flyio) |
| Clever Cloud (hébergeur français) | `deploy/clevercloud.env` | [Clever Cloud](docs/self-hosting.md#clever-cloud) |
| Coolify, Dokploy, Docker | `docker-compose.yml` | [Coolify et Dokploy](docs/self-hosting.md#coolify-et-dokploy), [Docker](docs/self-hosting.md#docker) |

Le guide complet est dans [docs/self-hosting.md](docs/self-hosting.md).

## Fonctionnalités

| Domaine | Ce que fait Kledg |
| --- | --- |
| Sociétés | Multi-sociétés, informations et établissements, membres et rôles (administrateur, comptable, lecture seule), clés API |
| Comptabilité | Plan comptable PCG 2026, journaux, exercices (ouverture, clôture, à-nouveaux), écritures avec contrôles PCG |
| Banque | Import de relevés, synchronisation Qonto et Revolut Business en direct, autres banques via Ponto (optionnelles), règles d'affectation automatiques, rapprochement |
| Immobilisations | Fiche immobilisation, plan d'amortissement linéaire, tableau des amortissements |
| États | Bilan, compte de résultat, balance, grand livre, journal, exports PDF et Excel |
| Données | Export FEC conforme, import FEC, CSV et Excel |
| Assistants IA | Serveur MCP pour Claude, ChatGPT et Claude Code (OAuth ou clé API) |

**Prochainement** : TVA, IS, liasse fiscale, CFE et CVAE, tiers et factures, notes de frais, IA intégrée.

## Stack

- **Next.js 16** (App Router) et **React 19**, interface **shadcn/ui** et Tailwind CSS 4
- **PostgreSQL** via **Prisma 7** (adaptateur `pg`) : Neon par défaut, toute base PostgreSQL convient
- **Better Auth** pour l'authentification, **Resend** pour les emails
- **Model Context Protocol** : serveur MCP intégré, sans clé de modèle à configurer

## Développement local

Prérequis : Node.js 20.9+, pnpm, Docker (ou un PostgreSQL existant).

```bash
git clone https://github.com/kledghq/kledg.git && cd kledg
pnpm install
docker compose -f docker-compose.dev.yml up -d   # PostgreSQL local
cp .env.example .env    # puis renseignez BETTER_AUTH_SECRET et ADMIN_EMAIL
pnpm db:migrate
pnpm dev
```

Ouvrez http://localhost:3000 : vous arrivez sur `/setup`. Sans `RESEND_API_KEY`, les emails (réinitialisation de mot de passe, invitations) s'affichent dans la console du serveur.

| Commande | Rôle |
| --- | --- |
| `pnpm dev` | Serveur de développement |
| `pnpm test:run` | Tests (Vitest) |
| `pnpm typecheck` | Vérification TypeScript |
| `pnpm lint` | ESLint |
| `pnpm db:migrate:dev` | Créer une migration après modification de `prisma/schema.prisma` |
| `pnpm db:studio` | Explorer la base |

## Avertissement

Kledg est un outil d'aide à la tenue de comptabilité. Il ne remplace pas un expert-comptable : vérifiez vos états avant de les utiliser. Le logiciel est fourni sans garantie (voir la licence).

## Licence

[AGPL-3.0](LICENSE). Vous pouvez utiliser, modifier et héberger Kledg librement ; si vous proposez une version modifiée à des tiers via un réseau, vous devez publier vos modifications sous la même licence.
