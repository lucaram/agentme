import { AuthForm } from "../AuthForm";
import { signIn } from "../actions";

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const { next, reason } = await searchParams;
  return <>{reason === "business-access" && <p className="mx-auto mt-6 max-w-md rounded-xl border border-border p-4 text-sm" role="status">Your business access has ended or your work session has expired. Log in to your personal account to continue.</p>}<AuthForm mode="login" action={signIn} next={typeof next === "string" ? next : undefined} /></>;
}
