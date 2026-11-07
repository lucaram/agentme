import { AuthForm } from "../AuthForm";
import { signIn } from "../actions";

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const { next } = await searchParams;
  return <AuthForm mode="login" action={signIn} next={typeof next === "string" ? next : undefined} />;
}
