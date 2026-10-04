# Auto-hébergement

Kledg est conçu pour être déployé par chaque organisation sur sa propre infrastructure. Le chemin recommandé est **Vercel + Neon + Resend** : tout tient dans les offres gratuites pour démarrer, sans serveur à administrer.

## Ce dont vous avez besoin

| Service | Rôle | Obligatoire |
| --- | --- | --- |
| [Vercel](https://vercel.com) | Héberge l'application (Next.js) | Oui, ou un autre hébergeur ci-dessous |
| [Neon](https://neon.tech) | Base PostgreSQL | Oui, ou tout PostgreSQL 15+ |
| [Resend](https://resend.com) | Emails (mot de passe oublié, invitations) | Recommandé |

## Choisir un hébergement

Chaque hébergement a son fichier de configuration dans le dépôt. Hors Vercel, tous construisent l'image du `Dockerfile`, qui applique les migrations de la base avant de démarrer.

| Hébergement | Fichier | Base de données | Migrations | Mise à jour en deux clics | Coût |
| --- | --- | --- | --- | --- | --- |
| [Vercel + Neon](#déploiement-sur-vercel) | `vercel.json` | Neon | `vercel-build` | Oui | voir la tarification de l'hébergeur |
| [Railway](#railway) | `railway.json` | Service PostgreSQL Railway | `preDeployCommand` | Oui (déploiement depuis GitHub) | voir la tarification de l'hébergeur |
| [Render](#render) | `render.yaml` | Render Postgres | `preDeployCommand` | Oui (déploiement depuis GitHub) | voir la tarification de l'hébergeur |
| [Fly.io](#flyio) | `fly.toml` | Fly Postgres, Neon ou autre | `release_command` | Avec le workflow GitHub Actions | voir la tarification de l'hébergeur |
| [Clever Cloud](#clever-cloud) | `deploy/clevercloud.env` | Module PostgreSQL Clever Cloud | Au démarrage du conteneur | Si l'application est liée à GitHub | voir la tarification de l'hébergeur |
| [Coolify, Dokploy](#coolify-et-dokploy) | `docker-compose.yml` | Conteneur PostgreSQL | Au démarrage du conteneur | Si le déploiement automatique est activé | votre serveur |
| [Docker](#docker) | `docker-compose.yml` | Conteneur PostgreSQL ou base existante | Au démarrage du conteneur | Non (commandes sur le serveur) | votre serveur |
| [Node.js](#hors-vercel) | `package.json` | Toute base PostgreSQL | `pnpm db:migrate` | Non | votre serveur |

Clever Cloud est une société française qui héberge en France : un critère possible pour des données comptables.

Quel que soit l'hébergeur, il vous faut les variables de [configuration.md](configuration.md) : au minimum `DATABASE_URL`, `BETTER_AUTH_SECRET`, `ADMIN_EMAIL` et `SETUP_TOKEN` (ou `RESEND_API_KEY`, pour recevoir le lien d'installation par email), puis `TRUST_PROXY_HOPS` (voir [Adresse IP des clients](#adresse-ip-des-clients)).

## Déploiement sur Vercel

1. Cliquez sur **Déployer sur Vercel** dans le [README](../README.md). Vercel crée une copie du dépôt sur votre compte GitHub, le projet, une base Neon (variables `DATABASE_URL` et `DATABASE_URL_UNPOOLED`) reliée au projet. Resend n'est pas dans le bouton : tant que son domaine n'est pas vérifié, l'intégration reste en attente et bloque le déploiement ; ajoutez-le ensuite (voir [Emails](#emails)). Pour la base, choisissez la région **Frankfurt (eu-central-1)** (les fonctions de Kledg tournent à Francfort, `fra1`, voir `vercel.json`), désactivez l'option **Auth** (Neon Auth, inutile : Kledg a sa propre authentification) et gardez l'offre **Free**.
2. Renseignez les deux variables demandées :
   - `BETTER_AUTH_SECRET` : générez-la avec `openssl rand -base64 32`. Gardez-la : la clé qui chiffre les identifiants bancaires en est dérivée.
   - `ADMIN_EMAIL` : votre email, seul autorisé à créer le compte administrateur.
3. Le build exécute `prisma migrate deploy` puis `next build` (script `vercel-build`, `scripts/vercel-build.mjs`) : la base est créée automatiquement. Un aperçu sans base de données, comme celui de la pull request d'une mise à jour, saute les migrations et construit seulement : il vérifie que la mise à jour compile, sans toucher à la base de production. Vercel renvoie ensuite vers https://www.kledg.com/fr/welcome, qui récapitule la suite.
4. Ouvrez `https://<votre-instance>/setup?token=<jeton>` et créez le compte administrateur. Sans `SETUP_TOKEN` ni emails, le jeton est dérivé de `BETTER_AUTH_SECRET` (HMAC-SHA256 de `kledg:setup-token:v1`, en base64url, voir `lib/setup.ts`) : le guide de déploiement de kledg.com le calcule dans le navigateur et donne le lien complet. Avec `RESEND_API_KEY`, `/setup` propose aussi d'envoyer le lien à `ADMIN_EMAIL`. `SETUP_TOKEN` et `CRON_SECRET` restent possibles (voir [configuration.md](configuration.md)) mais ne sont plus nécessaires sur Vercel.
5. Créez votre première société, puis importez un FEC ou connectez votre banque.

### Domaine personnalisé

Ajoutez votre domaine dans les paramètres du projet Vercel, puis définissez `BETTER_AUTH_URL=https://compta.votre-domaine.fr`. Sans cette variable, Kledg utilise l'URL de production Vercel.

### Assistants IA

Kledg n'appelle aucun modèle d'IA lui-même. Votre assistant (Claude, ChatGPT, Claude Code) se connecte à l'instance par le serveur MCP intégré, sans configuration côté serveur : voir [mcp.md](mcp.md).

## Emails

1. Créez un compte Resend et ajoutez un domaine d'envoi (par exemple `mail.votre-domaine.fr`), puis les enregistrements DNS indiqués.
2. Créez une clé API avec la permission « Sending access ».
3. Définissez `RESEND_API_KEY` et `EMAIL_FROM="Kledg <compta@mail.votre-domaine.fr>"`.

Sans Resend, Kledg reste utilisable : les emails sont écrits dans les logs du serveur et l'ajout d'un membre affiche un mot de passe temporaire à lui transmettre. En revanche, un utilisateur ne peut pas changer son adresse email depuis son profil, car la nouvelle adresse doit être confirmée par un lien envoyé par email ; seul un administrateur de l'instance peut alors changer sa propre adresse, après avoir saisi son mot de passe.

## Railway

Fichier : `railway.json` (construction depuis le `Dockerfile`, migrations en *pre-deploy*, vérification de santé sur `/api/health`).

1. Dans Railway, **New Project**, **Deploy from GitHub repo**, puis votre fork ou votre copie de `kledghq/kledg`. Railway lit `railway.json`.
2. Dans le même projet, **New**, **Database**, **PostgreSQL**. Le service s'appelle `Postgres`.
3. Dans les variables du service Kledg (*Variables*, *Raw Editor*) :

   ```bash
   DATABASE_URL=${{Postgres.DATABASE_URL}}
   BETTER_AUTH_SECRET=        # openssl rand -base64 32
   SETUP_TOKEN=               # openssl rand -base64 24
   ADMIN_EMAIL=vous@exemple.fr
   TRUST_PROXY_HOPS=1
   KLEDG_BACKUP=off
   ```

   `${{Postgres.DATABASE_URL}}` est une référence : Railway y met l'URL privée du service PostgreSQL (`postgres.railway.internal`, réseau privé chiffré, sans TLS côté Kledg).
4. *Settings*, *Networking*, **Generate Domain** : Railway donne un domaine `*.up.railway.app`. Kledg le lit dans `RAILWAY_PUBLIC_DOMAIN` ; `BETTER_AUTH_URL` n'est nécessaire qu'avec votre propre domaine.
5. Ouvrez `https://<domaine>/setup?token=<SETUP_TOKEN>`.

**Migrations** : `preDeployCommand` lance `/app/docker-migrate.sh` avant que la nouvelle version reçoive du trafic ; si une migration échoue, l'ancienne version continue de servir. Le conteneur relance la même commande au démarrage, sans effet si tout est déjà appliqué.

**Mises à jour** : Railway redéploie à chaque push sur la branche suivie. Le workflow *Update from Kledg* et la page **Mises à jour** fonctionnent comme sur Vercel ([Mettre à jour](#mettre-à-jour)) ; la page affiche le commit déployé (`RAILWAY_GIT_COMMIT_SHA`) et détecte le dépôt (`RAILWAY_GIT_REPO_OWNER`, `RAILWAY_GIT_REPO_NAME`).

**Sauvegardes** : celles du service PostgreSQL de Railway (selon l'offre), plus un `pg_dump` régulier vers un stockage que vous contrôlez ([Sauvegardes](#sauvegardes)). `KLEDG_BACKUP=off` évite une sauvegarde inutile sur le disque du conteneur, effacé à chaque déploiement.

**Coût** : voir la tarification de l'hébergeur.

### Modèle Railway (bouton « Deploy on Railway »)

Un bouton suppose un modèle publié depuis un compte Railway (*Workspace settings*, *Templates*). Pour publier celui de Kledg : un service depuis le dépôt GitHub (il lit `railway.json`), un service PostgreSQL nommé `Postgres`, et ces variables sur le service Kledg :

| Variable | Valeur dans le modèle | Rôle |
| --- | --- | --- |
| `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` | URL privée de la base |
| `BETTER_AUTH_SECRET` | `${{secret(32)}}` | Généré au déploiement |
| `SETUP_TOKEN` | `${{secret(32)}}` | Généré au déploiement ; lisez-le dans les variables du service |
| `ADMIN_EMAIL` | demandé à l'utilisateur | Seul email accepté par `/setup` |
| `TRUST_PROXY_HOPS` | `1` | Le proxy de Railway ajoute l'adresse du client à `X-Forwarded-For` |
| `KLEDG_BACKUP` | `off` | Pas de sauvegarde sur le disque éphémère |
| `BETTER_AUTH_URL` | vide | Repli sur `RAILWAY_PUBLIC_DOMAIN` ; à définir avec un domaine personnalisé |

Le bouton prend alors la forme `https://railway.com/new/template/<code du modèle>` (voir la documentation Railway, *Publish and Share Templates*).

## Render

Fichier : `render.yaml` (Blueprint : service web depuis le `Dockerfile` et base Render Postgres, à Francfort).

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/kledghq/kledg)

1. Cliquez sur le bouton (ou, depuis votre fork : **New**, **Blueprint**, puis le dépôt). Render crée le service `kledg` et la base `kledg-db`.
2. Render demande `ADMIN_EMAIL`, puis `RESEND_API_KEY` et `EMAIL_FROM` (facultatifs). Il génère `BETTER_AUTH_SECRET`, `SETUP_TOKEN` et `CRON_SECRET` (`generateValue`) et relie `DATABASE_URL` à la base (URL interne, sans TLS côté Kledg).
3. Lisez `SETUP_TOKEN` dans l'onglet *Environment* du service, puis ouvrez `https://<service>.onrender.com/setup?token=<SETUP_TOKEN>`. Kledg lit l'URL dans `RENDER_EXTERNAL_URL` ; définissez `BETTER_AUTH_URL` avec votre propre domaine.

**Migrations** : `preDeployCommand` lance `/app/docker-migrate.sh` sur une instance à part, avant la bascule ; une migration en échec annule le déploiement. Render réserve le *pre-deploy* aux instances payantes : sur une instance gratuite, retirez la ligne si Render la refuse, le conteneur applique les migrations à son démarrage.

**Mises à jour** : `autoDeployTrigger: commit` redéploie à chaque commit de la branche suivie. La mise à jour en deux clics de la page **Mises à jour** fonctionne (commit `RENDER_GIT_COMMIT`, dépôt `RENDER_GIT_REPO_SLUG`).

**Sauvegardes** : celles de Render Postgres (selon l'offre), plus un `pg_dump` régulier ([Sauvegardes](#sauvegardes)). La base n'accepte aucune connexion depuis Internet (`ipAllowList: []`) : ajoutez votre adresse dans la console Render le temps d'un `pg_dump` externe.

**Coût** : voir la tarification de l'hébergeur (le Blueprint ne fixe pas d'offre : choisissez-la à la création ; l'offre gratuite a des limites, lisez-les avant d'y mettre votre comptabilité).

## Fly.io

Fichier : `fly.toml` (service HTTP sur le port 3000, vérification `/api/health`, migrations en `release_command`, arrêt et redémarrage automatiques des machines).

```bash
fly launch --no-deploy --copy-config      # garde fly.toml, choisit le nom de l'application
fly secrets set BETTER_AUTH_SECRET="$(openssl rand -base64 32)" \
  SETUP_TOKEN="$(openssl rand -base64 24)" ADMIN_EMAIL=vous@exemple.fr
```

Base de données, au choix :

- **Fly Postgres** : `fly postgres create`, puis `fly postgres attach <nom-de-la-base>` (définit le secret `DATABASE_URL`, adresse `*.flycast` sur le réseau privé chiffré : Kledg s'y connecte sans TLS).
- **Neon ou un autre PostgreSQL** : `fly secrets set DATABASE_URL="postgresql://..."` (TLS par défaut). Choisissez une région proche de `primary_region` (`cdg`, Paris).

Puis :

```bash
fly deploy --build-arg KLEDG_COMMIT=$(git rev-parse HEAD)
fly secrets list    # SETUP_TOKEN n'est pas réaffiché : gardez la valeur générée
```

Ouvrez `https://<application>.fly.dev/setup?token=<SETUP_TOKEN>`. Kledg déduit cette URL de `FLY_APP_NAME` ; avec votre propre domaine (`fly certs add`), définissez `BETTER_AUTH_URL`.

**Migrations** : `release_command` lance `/app/docker-migrate.sh` dans une machine temporaire, avec les secrets de l'application, avant de remplacer les machines ; une migration en échec arrête le déploiement.

**Mises à jour** : Fly.io ne redéploie pas tout seul depuis GitHub. Ajoutez ce workflow à votre dépôt (`.github/workflows/fly-deploy.yml`) et le secret de dépôt `FLY_API_TOKEN` (`fly tokens create deploy`), puis définissez `KLEDG_DEPLOYS_FROM_GITHUB=true` (`fly secrets set`) pour la mise à jour en deux clics :

```yaml
name: Fly Deploy
on:
  push:
    branches: [main]
jobs:
  deploy:
    runs-on: ubuntu-latest
    concurrency: deploy-group
    steps:
      - uses: actions/checkout@v4
      - uses: superfly/flyctl-actions/setup-flyctl@master
      - run: flyctl deploy --remote-only --build-arg KLEDG_COMMIT=${{ github.sha }}
        env:
          FLY_API_TOKEN: ${{ secrets.FLY_API_TOKEN }}
```

Le workflow *Update from Kledg* laisse vos fichiers de workflow tels quels : celui-ci reste en place à chaque mise à jour. Sans lui, la page **Mises à jour** affiche les commandes `git pull` et `fly deploy`.

**Sauvegardes** : Fly Postgres n'est pas une base managée ; vérifiez les instantanés de son volume (`fly volumes list`, puis `fly volumes snapshots list <id du volume>`) et planifiez un `pg_dump`. Avec Neon, utilisez ses branches et son historique.

**Coût** : voir la tarification de l'hébergeur. `auto_stop_machines = "stop"` arrête la machine sans trafic ; la première requête la redémarre.

## Clever Cloud

Clever Cloud est un hébergeur français. Kledg s'y déploie en application **Docker** (le `Dockerfile` du dépôt) avec le module **PostgreSQL**.

1. Créez l'application : console Clever Cloud, **Create**, **An application**, type **Docker**, depuis votre dépôt GitHub (déploiement à chaque push) ou par `git push` vers le dépôt Git de l'application. Avec Clever Tools : `clever create --type docker kledg`.
2. Créez un module **PostgreSQL** et liez-le à l'application (*Service dependencies*). Clever Cloud injecte `POSTGRESQL_ADDON_URI`, que Kledg lit quand `DATABASE_URL` n'est pas défini (migrations comprises).
3. Copiez `deploy/clevercloud.env` hors du dépôt, remplissez-le, puis `clever env import < kledg.env`. Il définit `PORT=8080` (le port vers lequel Clever Cloud envoie le trafic des applications Docker), `CC_HEALTH_CHECK_PATH=/api/health` (un déploiement dont `/api/health` ne répond pas 2xx échoue), `BETTER_AUTH_URL`, `BETTER_AUTH_SECRET`, `ADMIN_EMAIL`, `SETUP_TOKEN`, `TRUST_PROXY_HOPS=1` et `KLEDG_BACKUP=off`. Ne commitez jamais le fichier rempli.
4. `BETTER_AUTH_URL` est obligatoire : Clever Cloud ne donne le domaine de l'application dans aucune variable. `clever domain` l'affiche (domaine `cleverapps.io` par défaut, ou le vôtre).
5. Déployez (`clever deploy` ou push), puis ouvrez `https://<domaine>/setup?token=<SETUP_TOKEN>`.

**Migrations** : sur une application Docker, les *hooks* `CC_PRE_BUILD_HOOK`, `CC_POST_BUILD_HOOK` et `CC_PRE_RUN_HOOK` s'exécutent sur la machine hôte, pas dans l'image : c'est donc l'entrypoint du conteneur qui applique les migrations au démarrage. Plusieurs instances qui démarrent ensemble ne se gênent pas (verrou de `prisma migrate deploy`).

**Connexions** : chaque offre du module PostgreSQL limite le nombre de connexions simultanées. Gardez `DATABASE_POOL_MAX` (10 par défaut) multiplié par le nombre d'instances sous cette limite (voir la tarification de l'hébergeur), avec de la marge pour les migrations.

**Mises à jour** : si l'application est liée à votre dépôt GitHub, Clever Cloud redéploie à chaque push : définissez `KLEDG_DEPLOYS_FROM_GITHUB=true` pour la mise à jour en deux clics. Le commit déployé vient de `CC_COMMIT_ID`. Sinon : `git pull https://github.com/kledghq/kledg.git main`, puis `git push` vers le dépôt Git de l'application.

**Sauvegardes** : Clever Cloud sauvegarde le module PostgreSQL chaque jour et garde les sauvegardes sept jours, sauf sur l'offre DEV (sans sauvegarde, pour les essais uniquement). Elles se téléchargent depuis la console. Ajoutez un `pg_dump` vers un stockage que vous contrôlez.

**Coût** : voir la tarification de l'hébergeur.

### Sans Docker (application Node.js)

Possible aussi, avec ces variables (documentation Node.js de Clever Cloud) : `CC_NODE_DEV_DEPENDENCIES=install` (la construction a besoin des dépendances de développement), `CC_POST_BUILD_HOOK="pnpm build && cp -r public .next/standalone/ && cp -r .next/static .next/standalone/.next/"`, `CC_PRE_RUN_HOOK="pnpm db:migrate"`, `CC_RUN_COMMAND="node .next/standalone/server.js"`, `HOSTNAME=0.0.0.0`, `NODE_ENV=production`, et les variables de Kledg ci-dessus sans `PORT` (Clever Cloud définit `PORT=8080`, que le serveur lit). pnpm est choisi d'après `pnpm-lock.yaml` et la version de `packageManager`. Sans Docker, pas de sauvegarde automatique avant les migrations.

## Coolify et Dokploy

Fichier : `docker-compose.yml`, utilisable tel quel : service `kledg` construit depuis le `Dockerfile`, service `db` (PostgreSQL 17), vérifications de santé, volumes `kledg-postgres` (données) et `kledg-backups` (sauvegardes `pg_dump` avant chaque migration). Les variables marquées `:?` sont obligatoires : le déploiement refuse de démarrer sans elles.

| Variable | Valeur |
| --- | --- |
| `POSTGRES_PASSWORD` | Lettres et chiffres uniquement (`openssl rand -hex 24`) : il entre dans l'URL de connexion |
| `BETTER_AUTH_SECRET` | `openssl rand -base64 32` |
| `BETTER_AUTH_URL` | URL publique, par exemple `https://compta.votre-domaine.fr` |
| `ADMIN_EMAIL` | Seul email accepté par `/setup` |
| `SETUP_TOKEN` | `openssl rand -base64 24` |
| `TRUST_PROXY_HOPS` | `1` par défaut (le proxy Traefik ou Caddy de la plateforme) ; `2` derrière un DNS Cloudflare en mode proxy |

Aucun port n'est publié : la plateforme envoie le domaine vers le port 3000 du service `kledg` par son proxy.

**Coolify** : **New Resource**, votre dépôt, *Build Pack* **Docker Compose** (fichier `/docker-compose.yml`). Remplissez les variables (Coolify signale celles qui manquent), puis indiquez le domaine du service `kledg` avec son port : `https://compta.votre-domaine.fr:3000`. Activez le déploiement automatique (application GitHub ou webhook) et définissez `KLEDG_DEPLOYS_FROM_GITHUB=true` pour la mise à jour en deux clics. Pour afficher le commit, activez *Include Source Commit in Build* ou passez `KLEDG_COMMIT`.

**Dokploy** : **Create Service**, **Compose**, votre dépôt et le chemin `docker-compose.yml`. Les variables de l'onglet *Environment* sont écrites dans un fichier `.env` à côté du fichier Compose, que Compose lit pour les `${...}`. Dans *Domains*, ajoutez le domaine sur le service `kledg`, port 3000. Le webhook de Dokploy redéploie à chaque push : définissez alors `KLEDG_DEPLOYS_FROM_GITHUB=true`. Les volumes nommés peuvent être sauvegardés vers S3 par *Volume Backups*.

**Sauvegardes** : le volume `kledg-backups` garde les 5 dernières sauvegardes prises avant une migration ; ajoutez une sauvegarde planifiée de la base (Coolify sait sauvegarder une base PostgreSQL vers S3) et copiez les fichiers hors du serveur.

## Docker

L'image se construit depuis un clone du dépôt. Passez le commit en argument de construction pour que la page **Mises à jour** l'affiche :

```bash
git clone https://github.com/kledghq/kledg.git && cd kledg
docker build --build-arg KLEDG_COMMIT=$(git rev-parse HEAD) -t kledg .
```

Le fichier `docker-compose.yml` lance Kledg et sa base. Créez un fichier `.env` à côté avec les variables du tableau de [Coolify et Dokploy](#coolify-et-dokploy), puis publiez le port, réservé à la machine, dans un fichier `docker-compose.override.yml` (ignoré par Git, lu automatiquement par Compose) :

```yaml
services:
  kledg:
    ports:
      - "127.0.0.1:3000:3000"
```

```bash
export KLEDG_COMMIT=$(git rev-parse HEAD)
docker compose up -d --build
```

Placez un reverse proxy (Caddy, nginx, Traefik) devant le port 3000 pour HTTPS et gardez `TRUST_PROXY_HOPS=1` ; sans proxy, mettez `TRUST_PROXY_HOPS=0`, sinon un client pourrait choisir son adresse IP. Pour une base existante, retirez le service `db` et définissez `DATABASE_URL`.

Au démarrage, le conteneur applique les migrations en attente (`/app/docker-migrate.sh`). Il sauvegarde d'abord la base avec `pg_dump` dans `/app/backups` (les 5 dernières sauvegardes sont gardées) ; montez ce dossier sur un volume. Variables : `KLEDG_BACKUP=off` pour ne pas sauvegarder, `KLEDG_BACKUP_DIR`, `KLEDG_BACKUP_KEEP`, `SKIP_MIGRATIONS=true` si un autre processus migre la base. Avec des arguments, l'entrypoint les exécute à la place du serveur : `docker run --rm --env-file .env kledg /app/docker-migrate.sh` migre sans démarrer Kledg (c'est ce que font les commandes de *pre-deploy* et de *release* des hébergeurs). Pour restaurer une sauvegarde : `pg_restore --clean --no-owner -d "$DATABASE_URL" kledg-<date>.dump`, avec le `pg_restore` de l'image (PostgreSQL 18).

Le service `db` de `docker-compose.yml` ne sert qu'à une instance. Pour développer, la base locale est dans `docker-compose.dev.yml` (`docker compose -f docker-compose.dev.yml up -d`).

## Hors Vercel

Sans Docker, Kledg est une application Next.js standard :

```bash
pnpm install --frozen-lockfile
pnpm db:migrate        # prisma migrate deploy
pnpm build
pnpm start             # port 3000
```

Points d'attention :

- Définissez `BETTER_AUTH_URL` avec l'URL publique de l'instance.
- La synchronisation bancaire quotidienne est un appel HTTP : voir [Tâches planifiées](#tâches-planifiées).

## Isolation des sociétés dans la base (RLS)

Kledg sépare les sociétés dans l'application. Avec `KLEDG_RLS=enforce`, PostgreSQL le garantit aussi (sécurité au niveau des lignes) : même une requête qui oublierait son filtre ne lit ni n'écrit les lignes d'une autre société. Recommandé dès que l'instance héberge des sociétés qui ne doivent pas se voir. Détails : [rls.md](rls.md).

Par défaut (`KLEDG_RLS` absent ou `off`), rien ne change : les politiques sont dans la base mais laissent tout passer tant qu'elles ne sont pas activées.

Il faut deux rôles PostgreSQL : le propriétaire du schéma, qui applique les migrations (celui que vous utilisez aujourd'hui), et un rôle applicatif sans droits de structure, soumis aux politiques.

1. Mettez l'instance à jour (la migration ajoute les politiques).
2. Créez le rôle applicatif et activez les politiques, avec la connexion du propriétaire :

   ```bash
   DATABASE_MIGRATION_URL="<URL directe du propriétaire>" pnpm db:rls-role -- --password "$(openssl rand -base64 32)"
   ```

   Notez le mot de passe. Le script est idempotent ; `--role <nom>` choisit un autre nom que `kledg_app`, `--off` désactive les politiques.
3. Donnez ce rôle à l'application et activez l'isolation :
   - `KLEDG_DATABASE_URL` : la même URL que `DATABASE_URL`, avec `kledg_app` et son mot de passe ;
   - `KLEDG_RLS=enforce`.

   Les migrations continuent d'utiliser `DATABASE_MIGRATION_URL`, à défaut `DATABASE_URL_UNPOOLED` puis `DATABASE_URL` : gardez-y le propriétaire.
4. Redéployez. Au premier accès, Kledg vérifie que son rôle n'est ni superutilisateur, ni propriétaire des tables, ni `BYPASSRLS`, et que les politiques sont activées ; sinon il refuse toute requête et l'écrit dans le journal du serveur.

Par hébergement :

- **Vercel + Neon** : l'intégration Neon gère `DATABASE_URL` et `DATABASE_URL_UNPOOLED` (rôle propriétaire `neondb_owner`), laissez-les telles quelles. Lancez l'étape 2 depuis votre poste avec l'URL de `DATABASE_URL_UNPOOLED` (`vercel env pull` la récupère) ; créez le rôle par ce script plutôt que depuis la console Neon. Dans **Settings > Environment Variables**, ajoutez `KLEDG_DATABASE_URL` (l'URL avec pooling de `DATABASE_URL`, hôte `-pooler`, où vous remplacez l'utilisateur et le mot de passe par ceux de `kledg_app`) et `KLEDG_RLS=enforce`, pour Production et, si vous le souhaitez, Preview. Les branches Neon des déploiements Preview sont des copies de la base : elles contiennent déjà le rôle.
- **Docker, Coolify, Dokploy** : lancez l'étape 2 depuis une copie du dépôt, `DATABASE_MIGRATION_URL` pointant sur la base (le rôle `kledg` du conteneur PostgreSQL en est le propriétaire) ; ajoutez `KLEDG_DATABASE_URL` et `KLEDG_RLS=enforce` à l'environnement du service `app`. Les migrations du démarrage (`docker-migrate.sh`) utilisent `DATABASE_MIGRATION_URL` si vous la définissez, sinon `DATABASE_URL` (le propriétaire).
- **Railway, Render, Fly.io, Clever Cloud** : même principe. La variable injectée par l'hébergeur (`DATABASE_URL`, `POSTGRESQL_ADDON_URI`) reste celle du propriétaire et sert aux migrations ; `KLEDG_DATABASE_URL` désigne `kledg_app`.

Pour revenir en arrière : retirez `KLEDG_RLS` et `KLEDG_DATABASE_URL`, puis redéployez (le propriétaire n'est jamais soumis aux politiques).

## Adresse IP des clients

Kledg limite les tentatives de connexion par adresse IP et l'écrit dans le journal d'audit. Il ne croit un en-tête que si la configuration le lui dit ([configuration.md](configuration.md), `TRUST_PROXY_HOPS` et `RATE_LIMIT_IP_HEADER`) : par défaut, aucun. `TRUST_PROXY_HOPS=N` prend la N-ième adresse en partant de la droite de `X-Forwarded-For`, c'est-à-dire celle ajoutée par le N-ième proxy que vous contrôlez ; ce que le client a écrit à gauche est ignoré.

| Hébergement | Devant Kledg | Réglage |
| --- | --- | --- |
| Vercel | Réseau de Vercel | Rien : `x-vercel-forwarded-for`, posé par Vercel |
| Railway | Proxy de Railway | `TRUST_PROXY_HOPS=1` |
| Render | Cloudflare, puis le proxy de Render, qui ajoutent chacun une adresse | `TRUST_PROXY_HOPS=2` (dans `render.yaml`) |
| Fly.io | Fly Proxy | `RATE_LIMIT_IP_HEADER=Fly-Client-IP` (dans `fly.toml`), adresse vue par Fly Proxy |
| Clever Cloud | Reverse proxy de Clever Cloud | `TRUST_PROXY_HOPS=1` |
| Coolify, Dokploy | Traefik (ou Caddy) | `TRUST_PROXY_HOPS=1` (défaut de `docker-compose.yml`) |
| Docker derrière nginx, Caddy, Traefik | Votre proxy | `TRUST_PROXY_HOPS=1`, un de plus par proxy en amont |
| Tout hébergeur derrière Cloudflare (DNS en mode proxy) | Cloudflare en plus | Ajoutez 1, ou `RATE_LIMIT_IP_HEADER=CF-Connecting-IP` si le port n'est joignable que par Cloudflare |

Une valeur trop petite ne prend que l'adresse d'un proxy (limites partagées, sans faille) ; une valeur trop grande laisse le client choisir son adresse. En cas de doute, choisissez la plus petite. Vérification : connectez-vous, puis lisez l'adresse de l'entrée de connexion dans le journal d'audit ; ce doit être la vôtre.

## Santé de l'instance

`GET /api/health` répond `200 {"status":"ok"}` quand la base répond, `503 {"status":"error","database":"unreachable"}` sinon. Sans session, sans version ni détail, jamais mise en cache. Une rafale d'appels ne coûte qu'une requête `SELECT 1` toutes les deux secondes au plus par instance, et une base qui ne répond pas donne un 503 en quatre secondes au plus. Les fichiers de configuration de chaque hébergeur, le `HEALTHCHECK` de l'image et `docker-compose.yml` l'utilisent.

## Tâches planifiées

La synchronisation bancaire quotidienne est un appel HTTP : planifiez `GET /api/cron/sync-banks` (l'ancien chemin `/api/cron/sync-qonto` reste valable) avec l'en-tête `Authorization: Bearer $CRON_SECRET`. Vercel le fait seul (`vercel.json`). Ailleurs : cron système, tâche planifiée de l'hébergeur ou GitHub Actions dans votre dépôt :

```yaml
name: Synchronisation bancaire
on:
  schedule:
    - cron: "0 5 * * *"
jobs:
  sync:
    runs-on: ubuntu-latest
    steps:
      - run: curl -fsS -H "Authorization: Bearer ${{ secrets.CRON_SECRET }}" "${{ vars.KLEDG_URL }}/api/cron/sync-banks"
```

## Mettre à jour

### Depuis Kledg (page Mises à jour)

Les administrateurs de l'instance trouvent la page **Mises à jour** dans les paramètres (menu du compte, **Paramètres**, puis **Instance** dans la barre latérale). Sans rien configurer, elle affiche la version installée, la dernière version publiée de Kledg, les notes de version depuis votre version et les migrations de la base que la mise à jour appliquera. Un indicateur « Mise à jour disponible » apparaît dans l'en-tête des administrateurs (masquable jusqu'à la version suivante).

Quand l'hébergeur redéploie l'instance à chaque fusion sur la branche principale de votre dépôt GitHub, vous pouvez aussi connecter GitHub pour mettre à jour en deux clics. C'est automatique sur Vercel, et sur Railway et Render quand le déploiement vient d'un commit ; ailleurs (Fly.io avec GitHub Actions, Clever Cloud ou Coolify reliés à GitHub, webhook Dokploy), définissez `KLEDG_DEPLOYS_FROM_GITHUB=true`. La page dit, pour chaque hébergeur, comment la fusion arrive jusqu'à l'instance.

1. **Créer le jeton** : le bouton ouvre GitHub avec un jeton « fine-grained » prérempli (nom « Kledg updates », 90 jours, permissions minimales : Contents, Pull requests, Actions, Variables et Workflows en lecture et écriture, Deployments en lecture). Dans *Repository access*, choisissez *Only select repositories* puis le dépôt de votre instance : GitHub ne permet pas de le présélectionner.
2. **Coller le jeton** : Kledg vérifie l'accès au dépôt et les permissions, détecte s'il s'agit d'un fork ou d'une copie de `kledghq/kledg`, puis enregistre le jeton chiffré. Il n'est plus jamais affiché (seuls ses 4 derniers caractères et sa date d'expiration le sont) ; la page prévient deux semaines avant l'expiration.
3. **Préparer la mise à jour** : Kledg lance le workflow *Update from Kledg* de votre dépôt (et l'y ajoute s'il manque). La page affiche la pull request, son aperçu si l'hébergeur en construit un (Vercel, environnements de pull request de Railway ou Render) et les migrations.
4. **Installer la mise à jour** : après confirmation (et sauvegarde de la base si la mise à jour contient des migrations), Kledg fusionne la pull request. L'hébergeur déploie et applique les migrations ; la page détecte la nouvelle version à la fin du déploiement.

Le canal suivi (`releases`, `main` ou `off`, voir plus bas) se choisit aussi sur cette page. **Déconnecter** efface le jeton de Kledg ; supprimez-le aussi sur GitHub.

Sinon (Docker, Node.js, ou un hébergeur qui ne redéploie pas depuis GitHub), la page affiche les commandes à lancer, par exemple avec Docker :

```bash
cd kledg
git pull https://github.com/kledghq/kledg.git main
export KLEDG_COMMIT=$(git rev-parse HEAD)
docker compose up -d --build
```

### Par pull request (sans jeton)

Votre dépôt contient le workflow **Update from Kledg** (`.github/workflows/update-from-kledg.yml`). Chaque lundi, il regarde s'il y a du nouveau sur `kledghq/kledg` et, si c'est le cas, ouvre une pull request **« Mise à jour Kledg x.y.z »** qui liste les notes de version et les migrations de la base qu'elle apporte :

1. Vercel (ou Railway, Render avec les environnements de pull request) construit un aperçu de la pull request : vérifiez-le.
2. Si la pull request annonce des migrations, sauvegardez la base (sur Neon : créez une branche).
3. Fusionnez la pull request : l'hébergeur redéploie et applique les migrations. Avec Docker ou Node.js, récupérez ensuite la branche principale sur le serveur et relancez (commandes ci-dessus).

Rien n'est mis à jour sans votre fusion : vous gardez la main sur le moment de la mise à jour.

### Copie Vercel : historique distinct

Le bouton **Déployer sur Vercel** crée une copie dont l'historique Git commence par un seul commit, sans lien avec celui de `kledghq/kledg` ; selon les cas, le dossier `.github` n'est pas copié. Un `git merge` classique refuse alors la mise à jour (*refusing to merge unrelated histories*).

Le workflow le gère : à la première mise à jour, il retrouve le commit de Kledg dont votre copie est issue (même contenu, hors `.github`) et le rattache à votre historique sans modifier vos fichiers, puis fusionne la mise à jour normalement. Vos propres modifications sont conservées comme dans un fork ; seul un vrai conflit (le même passage modifié des deux côtés) demande une fusion à la main. Si le workflow manque à votre copie, la page **Mises à jour** l'ajoute, ou copiez le fichier `.github/workflows/update-from-kledg.yml` de `kledghq/kledg` dans votre dépôt.

### Fichiers de workflow

GitHub interdit au jeton des Actions de modifier les fichiers `.github/workflows`. Le workflow garde donc vos fichiers de workflow tels quels et le signale dans la pull request. Pour qu'ils suivent aussi Kledg, créez le secret de dépôt `KLEDG_UPDATE_TOKEN` (*Settings, Secrets and variables, Actions*) avec un jeton fine-grained limité au dépôt (Contents, Pull requests et Workflows en lecture et écriture). La page **Mises à jour** met elle-même à jour le workflow *Update from Kledg* avec son propre jeton.

### Choisir ce que vous suivez

Créez la variable de dépôt `KLEDG_UPDATES` (*Settings, Secrets and variables, Actions, Variables*) :

| Valeur | Effet |
| --- | --- |
| `releases` (par défaut) | Uniquement les versions publiées, avec leurs notes de version. Recommandé. |
| `main` | Chaque changement de la branche principale, pour tester en avance. |
| `off` | Aucune pull request de mise à jour. Vous mettez à jour à la main. |

### Migrations de la base

À partir de la version 0.1.0, les migrations sont uniquement additives : une version n'efface jamais une colonne ou une table encore utilisée par la version précédente. Une suppression se fait en deux temps (la version N cesse de l'utiliser, une version suivante la supprime), si bien qu'un retour à la version précédente reste possible.

Vous pouvez aussi le lancer à la main : onglet **Actions** de votre dépôt, **Update from Kledg**, **Run workflow**.

Si GitHub refuse que les Actions ouvrent des pull requests (réglage *Settings, Actions, General, Allow GitHub Actions to create and approve pull requests*), le workflow pousse quand même la branche `kledg-update` et affiche le lien pour ouvrir la pull request en un clic. Activez ce réglage pour que tout soit automatique.

### Forker plutôt que copier

Si vous préférez le bouton **Sync fork** de GitHub : forkez `kledghq/kledg` depuis GitHub, puis importez votre fork dans Vercel (*Add New, Project*) en ajoutant l'intégration Neon et les variables d'environnement décrites plus haut.

GitHub désactive les Actions d'un nouveau fork : la page **Mises à jour** réactive le workflow *Update from Kledg* avant de le lancer. Si votre fork n'a plus ce workflow, l'installation synchronise sa branche principale avec la branche `main` de Kledg (API *merge upstream*, l'équivalent de **Sync fork**), sans pull request ni aperçu.

### À la main

```bash
git remote add upstream https://github.com/kledghq/kledg.git
git pull upstream main
git push
```

Lisez les notes de version avant une mise à jour majeure. Neon permet de créer une branche de la base avant de migrer, pour revenir en arrière si besoin.

## Application installable

Kledg peut s'installer comme une application (écran d'accueil d'un téléphone, Dock, menu Démarrer) : fenêtre sans barre d'adresse, icône Kledg, page « Vous êtes hors ligne » quand le réseau manque. Rien n'est à configurer, mais **l'instance doit être servie en HTTPS** : les navigateurs refusent le service worker et l'installation sur une adresse `http://` (sauf `localhost`, pour les essais). Sur Vercel, c'est le cas par défaut ; derrière votre propre proxy, terminez TLS avec un certificat valide.

Installer :

- **Android (Chrome, Edge)** et **ordinateur (Chrome, Edge)** : menu du compte (en bas de la barre latérale), **Installer l'application**. L'entrée n'apparaît que lorsque le navigateur propose l'installation (HTTPS, application pas encore installée).
- **iPhone et iPad (Safari)** : bouton **Partager**, puis **Sur l'écran d'accueil**. Le menu **Aide** de l'en-tête le rappelle.

Ce que l'application garde sur l'appareil : la page hors ligne, les icônes et les fichiers de construction (JavaScript, CSS, polices), jamais une page connectée, une réponse de l'API ou une donnée comptable. Les pages viennent toujours du serveur : hors ligne, Kledg n'affiche que la page « Vous êtes hors ligne ». Après un déploiement, un message « Nouvelle version disponible » propose de recharger.

En cas de problème avec le service worker, définissez `NEXT_PUBLIC_DISABLE_SW=true`, reconstruisez et redéployez : chaque navigateur le désinscrit et supprime ses caches à sa visite suivante.

Vérifier une instance (Chrome, outils de développement, onglet **Application**) :

1. **Manifest** : nom Kledg, icônes 192 et 512 (dont une *maskable*), aucune erreur d'installabilité.
2. **Service workers** : `/sw.js?v=...` activé, portée `/`.
3. **Cache storage** : seulement `kledg-shell-*` (page hors ligne, icônes) et `kledg-static-*` (`/_next/static/...`).
4. **Network**, *Offline*, puis rechargez une page : la page « Vous êtes hors ligne » s'affiche ; repassez en ligne et cliquez sur **Réessayer**.

Lighthouse ne contrôle plus l'installabilité : le panneau **Manifest** le fait.

## Sauvegardes

Vos données comptables sont dans votre base PostgreSQL. Les bases managées ont leurs propres sauvegardes, dont la durée dépend de l'offre : historique de restauration et branches sur Neon, sauvegardes de Render Postgres et du service PostgreSQL de Railway, sauvegarde quotidienne du module PostgreSQL de Clever Cloud (sauf offre DEV). Fly Postgres n'est pas managé : ne comptez que sur les instantanés de son volume et sur vos `pg_dump`. Avec Docker, l'image sauvegarde la base avant chaque migration dans `/app/backups`.

Dans tous les cas, planifiez un `pg_dump` régulier vers un stockage que vous contrôlez, hors de l'hébergeur, et essayez de temps en temps une restauration (`pg_restore`). Pensez aussi à l'export FEC annuel, que la loi vous impose de pouvoir produire.

## Sécurité

- Gardez `BETTER_AUTH_SECRET` secret. Le changer déconnecte tout le monde et, si `ENCRYPTION_KEY` n'est pas défini, rend illisibles les identifiants bancaires enregistrés (il faudra reconnecter les intégrations).
- Il n'y a pas d'inscription publique : les comptes sont créés par l'administrateur.
- Le jeton GitHub de la page **Mises à jour** est chiffré comme les identifiants bancaires, réservé aux administrateurs de l'instance et n'est jamais renvoyé au navigateur. Kledg n'appelle que `https://api.github.com`, sur le seul dépôt de l'instance. Limitez le jeton à ce dépôt et donnez-lui une date d'expiration.
- Signalez une vulnérabilité selon [SECURITY.md](../SECURITY.md).
