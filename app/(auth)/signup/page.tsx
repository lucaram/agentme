import { AuthForm } from "../AuthForm";
import { signUp } from "../actions";

export default async function SignupPage({ searchParams }: PageProps<"/signup">) {
  const { next } = await searchParams;
  return <AuthForm mode="signup" action={signUp} next={typeof next === "string" ? next : undefined} />;
}
