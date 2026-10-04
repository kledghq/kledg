import { redirect } from "next/navigation";
import {
  getSetupAdminEmail,
  maskEmail,
  MIN_SETUP_TOKEN_LENGTH,
  needsSetup,
  setupTokenStatus,
  setupView,
} from "@/lib/setup";
import { isActionAllowed, SETUP_PENDING_REDIRECT } from "@/lib/instance";
import { AuthShell } from "@/components/brand/auth-shell";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { SetupForm } from "./setup-form";
import { RequestSetupLink } from "./request-link";

export const dynamic = "force-dynamic";

export const metadata = { title: "Configuration" };

/**
 * Shown while nobody can prove they own the instance: no SETUP_TOKEN (or one
 * too short), and no way to email a setup link to ADMIN_EMAIL. The page says
 * how to unlock it (lib/setup.ts).
 */
function SetupBlocked({ weak }: { weak: boolean }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h1>Installation bloquée</h1>
        </CardTitle>
        <CardDescription>
          {weak
            ? `La variable SETUP_TOKEN est trop courte (au moins ${MIN_SETUP_TOKEN_LENGTH} caractères).`
            : "Kledg ne peut pas encore vérifier que vous êtes le propriétaire de cette instance."}{" "}
          Sans cette vérification, la première personne à ouvrir cette page
          deviendrait administrateur de l&apos;instance.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p>Choisissez l&apos;une des deux méthodes, puis redéployez ou redémarrez l&apos;instance&nbsp;:</p>
        <ul className="list-inside list-disc space-y-2">
          <li>
            <strong>Par email</strong>&nbsp;: définissez{" "}
            <code className="bg-muted rounded px-1">ADMIN_EMAIL</code> et{" "}
            <code className="bg-muted rounded px-1">RESEND_API_KEY</code>.
            Cette page vous enverra un lien d&apos;installation.
          </li>
          <li>
            <strong>Par jeton</strong>&nbsp;: définissez{" "}
            <code className="bg-muted rounded px-1">SETUP_TOKEN</code> (par
            exemple{" "}
            <code className="bg-muted rounded px-1">
              openssl rand -base64 24
            </code>
            ), puis ouvrez{" "}
            <code className="bg-muted rounded px-1">
              /setup?token=&lt;votre jeton&gt;
            </code>
            .
          </li>
        </ul>
        <p className="text-muted-foreground text-xs">
          Sur Vercel&nbsp;: Settings, Environment Variables. Avec Docker&nbsp;: le
          fichier d&apos;environnement du conteneur.
        </p>
      </CardContent>
    </Card>
  );
}

/**
 * Shown without the installation link: the instance is not open yet. The
 * administrator finds the link (or the token) where they deployed it.
 */
function SetupPending() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h1>Installation en cours</h1>
        </CardTitle>
        <CardDescription>
          Cette instance de Kledg n&apos;est pas encore ouverte. Revenez dans
          quelques instants.
        </CardDescription>
      </CardHeader>
      <CardContent className="text-muted-foreground space-y-2 text-xs">
        <p>
          Administrateur&nbsp;: ouvrez le lien d&apos;installation donné à la
          fin du guide de déploiement de kledg.com.
        </p>
        <p>
          Sinon, calculez-le depuis votre secret{" "}
          <code className="bg-muted rounded px-1">BETTER_AUTH_SECRET</code>{" "}
          sur{" "}
          <a
            href="https://www.kledg.com/fr/docs/installer-kledg#créer-le-compte-administrateur"
            className="underline underline-offset-4"
          >
            kledg.com
          </a>{" "}
          (le calcul se fait dans votre navigateur), ou ouvrez{" "}
          <code className="bg-muted rounded px-1">
            /setup?token=&lt;SETUP_TOKEN&gt;
          </code>{" "}
          si vous l&apos;avez défini.
        </p>
      </CardContent>
    </Card>
  );
}

export default async function SetupPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string | string[] }>;
}) {
  // An instance whose policy refuses "setup" provisions its accounts otherwise.
  if (!(await isActionAllowed("setup")) || !(await needsSetup())) {
    redirect("/login");
  }

  const { token } = await searchParams;
  const urlToken = typeof token === "string" ? token : null;
  const view = await setupView(urlToken);
  if (view === "blocked") {
    return (
      <AuthShell>
        <SetupBlocked weak={setupTokenStatus() === "weak"} />
      </AuthShell>
    );
  }
  if (view === "request-link") {
    return (
      <AuthShell>
        <RequestSetupLink maskedEmail={maskEmail(getSetupAdminEmail() ?? "")} />
      </AuthShell>
    );
  }
  if (view === "pending") {
    if (SETUP_PENDING_REDIRECT) redirect(SETUP_PENDING_REDIRECT);
    return (
      <AuthShell>
        <SetupPending />
      </AuthShell>
    );
  }

  return (
    <AuthShell>
      <SetupForm
        adminEmail={getSetupAdminEmail()}
        initialToken={urlToken ?? ""}
      />
    </AuthShell>
  );
}
