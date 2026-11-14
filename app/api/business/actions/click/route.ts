import { createHash } from "node:crypto";
import { z } from "zod";
import { adminClient } from "@/lib/supabase/admin";
import { getUser } from "@/lib/auth";
import { env } from "@/lib/env";
import { hit } from "@/lib/limits";
import { trustedClientIp, ipTrustFromEnv } from "@/lib/a2a/client-ip";
import { waysOf, wayLabel, WAY_KINDS } from "@/lib/business/booking";
import { reservationWays } from "@/lib/business/reservations";

const Click = z.object({ id: z.uuid(), agentId: z.uuid().optional(), kind: z.enum(WAY_KINDS), value: z.string().max(500), label: z.string().max(60).optional(), source: z.enum(["public_page","plan","recall"]) });
export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin || ![new URL(request.url).origin,new URL(env.appUrl).origin].includes(origin)) return new Response(null,{status:403});
  const reader = request.body?.getReader();
  if (!reader) return new Response(null,{status:400});
  let bytes=0; const chunks: Uint8Array[]=[];
  while (true) { const {done,value}=await reader.read(); if(done)break; bytes+=value.length; if(bytes>2048){await reader.cancel();return new Response(null,{status:413});} chunks.push(value); }
  let input;
  try { input=Click.safeParse(JSON.parse(Buffer.concat(chunks).toString("utf8"))); } catch { return new Response(null,{status:400}); }
  if (!input.success) return new Response(null,{status:400});
  const click=input.data;
  const ip=createHash("sha256").update(trustedClientIp(request.headers,ipTrustFromEnv()) ?? "untrusted").digest("hex").slice(0,32);
  if (!(await hit("businessActionClicksPerIp",ip)).allowed) return new Response(null,{status:429});
  const db=adminClient();
  let businessId=click.agentId;
  if (!businessId) {
    // Older recall messages have no business id. Attribute only an unambiguous published action.
    const {data:matches}=await db.from("agents").select("id").eq("type","business").contains("business_info",{ways:[{kind:click.kind,value:click.value,...(click.label ? {label:click.label} : {})}]}).limit(2);
    if(matches?.length!==1) return new Response(null,{status:204});
    businessId=matches[0].id;
  }
  if (!(await hit("businessActionClicksPerAgent",businessId)).allowed) return new Response(null,{status:429});
  const {data:business}=await db.from("agents").select("id,owner_id,business_info").eq("id",businessId).eq("type","business").maybeSingle();
  if (!business) return new Response(null,{status:404});
  const user=await getUser();
  if (user) {
    if(user.id===business.owner_id) return new Response(null,{status:204});
    const {data:manager}=await db.from("business_managers").select("user_id").eq("business_agent_id",business.id).eq("user_id",user.id).maybeSingle();
    if(manager) return new Response(null,{status:204});
  }
  const {data:site}=await db.from("business_sites").select("url,live_at,learned,hidden").eq("agent_id",business.id).maybeSingle();
  const published=[...waysOf(business.business_info),...reservationWays(business.business_info,site)];
  const way=published.find((w)=>w.kind===click.kind && w.value===click.value && w.label===click.label);
  if(!way) return new Response(null,{status:400});
  const {error}=await db.from("business_action_events").insert({id:click.id,agent_id:business.id,kind:way.kind,label:wayLabel(way).slice(0,120),source:click.source});
  return new Response(null,{status:error && error.code!=="23505" ? 503 : 204});
}
