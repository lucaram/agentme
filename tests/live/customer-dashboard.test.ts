import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { ANON_KEY, SUPABASE_URL, dbUp } from "./env";
import { planBusinessFixture } from "../fixtures/plan-business";
import { businessDashboard } from "@/lib/business/dashboard";
import { POST } from "@/app/api/business/actions/click/route";

const auth = vi.hoisted(() => ({ owner: false, userId: "" }));
vi.mock("@/lib/auth", () => ({ getUser: async () => auth.owner ? { id: auth.userId } : null }));

describe.skipIf(!dbUp)("customer dashboard data and tracking", () => {
  let f: Awaited<ReturnType<typeof planBusinessFixture>>;
  const dashboard = (id: string, days: number) => businessDashboard(id, days, { id: f.business.userId, businessRole: "owner" });
  const day = (ago: number) => { const d=new Date(); d.setUTCHours(0,0,0,0); d.setUTCDate(d.getUTCDate()-ago); return d.toISOString(); };
  beforeAll(async () => {
    f=await planBusinessFixture(); auth.userId=f.business.userId;
    const rows = [
      [0,"Opening hours?","agent",["business_info"]],
      [1,"OPENING HOURS!","human",[]],
      [2,"Can you store kayaks?","agent",[]],
      [3,"Can you store kayaks?","agent",[]],
      [7,"Previous question","agent",["business_info"]],
      [20,"Older question","agent",["business_info"]],
    ] as const;
    const {data:exchanges,error}=await f.db.from("task_exchanges").insert(rows.map(([ago,text,by,categories])=>({from_agent:f.luca.agent.id,to_agent:f.business.agent.id,skill:"business.faq",status:"completed" as const,answered_by:by,disclosed_categories:[...categories],request:{text},created_at:day(ago)}))).select("id");
    if(error)throw error;
    const {error:inboxError}=await f.db.from("inbox_items").insert([
      {exchange_id:exchanges![1].id,status:"answered",question:"Opening hours?"},
      {exchange_id:exchanges![2].id,status:"open",question:"Can you store kayaks?"},
      {exchange_id:exchanges![3].id,status:"declined",question:"Can you store kayaks?"},
    ].map(({question,...item})=>({...item,owner_id:f.business.userId,agent_id:f.business.agent.id,from_agent:f.luca.agent.id,kind:"question",payload:{kind:"question",business:true,question}})));
    if(inboxError)throw inboxError;
  });
  afterAll(async () => { await f?.cleanup(); });

  it("aggregates real outcomes, complete daily buckets, repeated questions and prior periods without double counting",async()=>{
    const data=await dashboard(f.business.agent.id,7);
    expect(data?.totals).toMatchObject({received:4,automatic:1,team:1,unanswered:0,closed:1,redirected:0,previous:1});
    expect(data?.pending).toBe(1);
    expect(data?.daily).toHaveLength(7);
    expect(data!.daily.reduce((n,d)=>n+d.total,0)).toBe(4);
    expect(data!.daily.reduce((n,d)=>n+d.pending,0)).toBe(1);
    expect(data!.questions.find(q=>q.question.toLowerCase().startsWith("opening"))).toMatchObject({asked:2,automatic:1,needed_team:1});
    expect(data!.gaps.find(q=>q.question.includes("kayaks"))).toMatchObject({asked:2,needed_team:2,unresolved:1});
    expect((await dashboard(f.business.agent.id,30))?.totals.received).toBe(6);
    expect((await dashboard(f.business.agent.id,123))?.days).toBe(30);
    expect(await dashboard(f.marco.agent.id,7)).toBeNull();
  });

  it("separates genuine missing answers, closures and redirects for both old and new records",async()=>{
    const {data:rows,error}=await f.db.from("task_exchanges").insert([
      {status:"completed",answered_by:"agent",response:{text:"A structured redirect",data:{type:"agentme.business.redirect",scope:"unrelated"}}},
      {status:"completed",answered_by:"agent",response:{text:"I can help with questions about this business. Your personal agent can help with that question. I haven't asked the team."}},
      {status:"completed",answered_by:"agent",response:{text:"I don't have that information yet.",data:{type:"agentme.business.handoff_offer",faq_eligible:true}}},
      {status:"failed",answered_by:null,response:null},
      {status:"failed",answered_by:null,response:null},
      {status:"refused",answered_by:null,response:null},
    ].map((r,i)=>({...r,status:r.status as "completed"|"failed"|"refused",skill:"business.faq",from_agent:f.luca.agent.id,to_agent:f.business.agent.id,disclosed_categories:[],request:{text:`Outcome example ${i}`}}))).select("id");
    if(error)throw error;
    const {error:withdrawn}=await f.db.from("inbox_items").insert({owner_id:f.business.userId,agent_id:f.business.agent.id,from_agent:f.luca.agent.id,exchange_id:rows![4].id,kind:"question",status:"withdrawn",payload:{kind:"question",business:true,question:"Cancelled request"}});
    if(withdrawn)throw withdrawn;
    const data=(await dashboard(f.business.agent.id,7))!;
    expect(data.totals).toMatchObject({received:10,automatic:1,team:1,unanswered:2,closed:3,redirected:2});
    const daily=data.daily.reduce((a,d)=>({total:a.total+d.total,automatic:a.automatic+d.automatic,team:a.team+d.team,pending:a.pending+d.pending,unanswered:a.unanswered+d.unanswered,closed:a.closed+d.closed,redirected:a.redirected+d.redirected}),{total:0,automatic:0,team:0,pending:0,unanswered:0,closed:0,redirected:0});
    expect(daily).toEqual({total:10,automatic:1,team:1,pending:1,unanswered:2,closed:3,redirected:2});
    expect(daily.automatic+daily.team+daily.pending+daily.unanswered+daily.closed+daily.redirected).toBe(daily.total);
  });

  const click = (id=crypto.randomUUID(),value="https://sole.example/book",origin="http://localhost:3000") => new Request("http://localhost:3000/api/business/actions/click",{method:"POST",headers:{Origin:origin,"Content-Type":"application/json"},body:JSON.stringify({id,agentId:f.business.agent.id,kind:"book",value,source:"public_page"})});
  it("records a valid public click once, rejects forged URLs and excludes owner tests",async()=>{
    const id=crypto.randomUUID();
    expect((await POST(click(id))).status).toBe(204);
    expect((await POST(click(id))).status).toBe(204);
    expect((await POST(click(crypto.randomUUID(),"https://private.example/"))).status).toBe(400);
    expect((await POST(click(crypto.randomUUID(),undefined,"https://attacker.example"))).status).toBe(403);
    auth.owner=true;
    expect((await POST(click())).status).toBe(204);
    auth.owner=false;
    const data=await dashboard(f.business.agent.id,7);
    expect(data?.clicks).toHaveLength(1);
    expect(data!.clicks[0]).toMatchObject({kind:"book",clicks:1});
    expect(data?.tracking_since).toBeTruthy();
  });

  it("attributes legacy recall buttons without a business id only to a matching published action",async()=>{
    const url=`https://legacy-${f.business.agent.id}.example/book`;
    const {data:agent}=await f.db.from("agents").select("business_info").eq("id",f.business.agent.id).single();
    const info=agent!.business_info as {ways: {kind:string;value:string}[]};
    await f.db.from("agents").update({business_info:{...info,ways:[...info.ways,{kind:"book",value:url}]}}).eq("id",f.business.agent.id);
    const legacy=(value:string)=>new Request("http://localhost:3000/api/business/actions/click",{method:"POST",headers:{Origin:"http://localhost:3000"},body:JSON.stringify({id:crypto.randomUUID(),kind:"book",value,source:"recall"})});
    expect((await POST(legacy(url))).status).toBe(204);
    expect((await POST(legacy("https://unknown.example/book"))).status).toBe(204);
    expect((await f.db.from("business_action_events").select("id").eq("agent_id",f.business.agent.id).eq("source","recall")).data).toHaveLength(1);
  });

  it("keeps analytics private and prevents direct browser event forgery",async()=>{
    const client=createClient(SUPABASE_URL,ANON_KEY,{auth:{persistSession:false}});
    expect((await client.rpc("business_dashboard",{p_agent:f.business.agent.id})).error).toBeTruthy();
    await client.auth.signInWithPassword({email:f.luca.email,password:f.password});
    expect((await client.rpc("business_dashboard",{p_agent:f.business.agent.id})).error).toBeTruthy();
    expect((await client.from("business_action_events").select("*").eq("agent_id",f.business.agent.id)).data).toEqual([]);
    expect((await client.from("business_action_events").insert({id:crypto.randomUUID(),agent_id:f.business.agent.id,kind:"book",label:"Forged",source:"public_page"})).error).toBeTruthy();
  });
});
