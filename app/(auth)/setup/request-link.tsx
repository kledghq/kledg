"use client";

import { useState } from "react";
import { Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { requestSetupLink } from "./actions";

/**
 * Email mode of /setup (lib/setup.ts): the administrator asks for a one-time
 * link, sent to ADMIN_EMAIL only. Nothing to type: the address is fixed at
 * deployment.
 */
export function RequestSetupLink({ maskedEmail }: { maskedEmail: string }) {
  const [state, setState] = useState<
    | { status: "idle" | "loading" }
    | { status: "sent"; sentTo: string; ttlMinutes: number }
    | { status: "error"; error: string }
  >({ status: "idle" });

  async function send() {
    setState({ status: "loading" });
    const result = await requestSetupLink();
    setState(
      result.ok
        ? { status: "sent", sentTo: result.sentTo, ttlMinutes: result.ttlMinutes }
        : { status: "error", error: result.error },
    );
  }

  if (state.status === "sent") {
    return (
      <Card>
        <CardHeader>
          <CardTitle>
            <h1>Consultez vos emails</h1>
          </CardTitle>
          <CardDescription>
            Le lien d&apos;installation est parti vers {state.sentTo}. Il est
            valable {state.ttlMinutes} minutes et ouvre la création du compte
            administrateur.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <p className="text-muted-foreground">
            Rien reçu après une minute&nbsp;? Regardez dans les indésirables, puis
            renvoyez le lien.
          </p>
          <Button variant="outline" onClick={send}>
            Renvoyer le lien
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h1>Bienvenue sur Kledg</h1>
        </CardTitle>
        <CardDescription>
          Votre instance est en ligne. Pour créer le compte administrateur,
          recevez un lien d&apos;installation à l&apos;adresse définie lors du
          déploiement ({maskedEmail}).
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {state.status === "error" && (
          <Alert variant="destructive">
            <AlertDescription>{state.error}</AlertDescription>
          </Alert>
        )}
        <Button
          className="w-full"
          onClick={send}
          disabled={state.status === "loading"}
        >
          <Mail aria-hidden />
          {state.status === "loading"
            ? "Envoi…"
            : "Recevoir le lien d'installation"}
        </Button>
        <p className="text-muted-foreground text-xs">
          Seule cette adresse reçoit le lien&nbsp;: personne d&apos;autre ne peut
          créer le compte administrateur.
        </p>
      </CardContent>
    </Card>
  );
}
