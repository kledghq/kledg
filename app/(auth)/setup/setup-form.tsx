"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { createFirstAdmin } from "./actions";

export function SetupForm({
  adminEmail,
  initialToken,
}: {
  adminEmail: string | null;
  initialToken: string;
}) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState(adminEmail ?? "");
  const [password, setPassword] = useState("");
  const [token, setToken] = useState(initialToken);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const result = await createFirstAdmin({ name, email, password, token });
    if (!result.ok) {
      setError(result.error);
      setLoading(false);
      return;
    }

    const { error: signInError } = await authClient.signIn.email({
      email,
      password,
    });
    if (signInError) {
      router.push("/login");
      return;
    }
    // First run: the welcome page explains the instance, then creates the first company.
    router.push("/settings/configuration");
    router.refresh();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h1>Bienvenue sur Kledg</h1>
        </CardTitle>
        <CardDescription>
          Créez le compte administrateur de cette instance. Il pourra ensuite
          créer les sociétés et inviter les autres utilisateurs.
        </CardDescription>
      </CardHeader>
      <form onSubmit={handleSubmit}>
        <CardContent className="space-y-4">
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          {/* The installation link already carries the token: no need to show it. */}
          {!initialToken && (
            <div className="space-y-2">
              <Label htmlFor="token">Jeton d&apos;installation</Label>
              <Input
                id="token"
                type="password"
                autoComplete="off"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                required
                disabled={loading}
              />
              <p className="text-muted-foreground text-xs">
                Valeur de SETUP_TOKEN, définie lors du déploiement (ou ouvrez
                /setup?token=...).
              </p>
            </div>
          )}
          <div className="space-y-2">
            <Label htmlFor="name">Nom</Label>
            <Input
              id="name"
              autoComplete="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              disabled={loading}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              readOnly={Boolean(adminEmail)}
              disabled={loading}
            />
            {adminEmail && (
              <p className="text-muted-foreground text-xs">
                Défini par ADMIN_EMAIL lors du déploiement.
              </p>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">Mot de passe</Label>
            <Input
              id="password"
              type="password"
              autoComplete="new-password"
              minLength={10}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              disabled={loading}
            />
            <p className="text-muted-foreground text-xs">
              10 caractères minimum.
            </p>
          </div>
        </CardContent>
        <CardFooter className="pt-6">
          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? "Création..." : "Créer le compte administrateur"}
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
}
