import Link from "next/link";
import type { DashboardData } from "@/lib/business/dashboard";
import { SectionLink } from "@/components/SectionLink";

const rate = (part: number, total: number) => total ? Math.round(part / total * 100) : 0;
const date = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const colours = { automatic: "#34d399", team: "#60a5fa", pending: "#fbbf24", unanswered: "#fb7185", closed: "#94a3b8", redirected: "#c084fc" };
const outcomes = [["automatic", "Agent answered"], ["team", "Team answered"], ["pending", "Awaiting team"], ["unanswered", "Missed questions"], ["closed", "Closed questions"], ["redirected", "Redirected"]] as const;

export function CustomerDashboard({ data, approvedAnswers }: { data: DashboardData | null; approvedAnswers: number }) {
  if (!data) return <p role="alert" className="p-6 text-sm text-muted">Customer analytics could not be loaded. Please refresh to try again.</p>;
  const t = data.totals;
  const comparable = data.history_since && Date.parse(data.history_since) <= Date.parse(data.start) - data.days * 86400000;
  const change = comparable ? t.previous === t.received ? "Same number as the previous period" : t.previous ? `${Math.abs(Math.round((t.received - t.previous) / t.previous * 100))}% ${t.received > t.previous ? "more" : "fewer"} than the previous period` : "No questions in the previous period" : "More history is needed for a period comparison";
  const maximum = Math.max(4, Math.ceil(Math.max(0, ...data.daily.map((d) => d.total)) / 4) * 4);
  const barWidth = 640 / data.daily.length;
  const clickTotal = data.clicks.reduce((n, c) => n + c.clicks, 0);
  const channels = [
    { label: "Booking links", kinds: ["book"], icon: "📅" },
    { label: "Ordering links", kinds: ["order"], icon: "🛍️" },
    { label: "Call buttons", kinds: ["call"], icon: "📞" },
    { label: "WhatsApp", kinds: ["whatsapp"], icon: "💬" },
    { label: "Email buttons", kinds: ["email"], icon: "✉️" },
    { label: "Other links", kinds: ["website", "custom"], icon: "🔗" },
  ].map((channel) => ({ ...channel, count: data.clicks.filter((c) => channel.kinds.includes(c.kind)).reduce((n, c) => n + c.clicks, 0) }));
  return <section className="space-y-6 p-5 sm:p-6" aria-label="Customer dashboard" data-testid="customer-dashboard">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><h2 className="font-semibold">Your agent at work</h2><p className="hint">{date(data.start)} – {date(new Date(Date.parse(data.end) - 1).toISOString())} · UTC</p></div>
      <nav aria-label="Dashboard period" className="flex gap-1 rounded-full border border-border p-1">{[7, 30, 90].map((days) => <Link key={days} href={`/business?days=${days}#customer-dashboard`} aria-current={data.days === days ? "page" : undefined} className={`rounded-full px-3 py-1.5 text-sm ${data.days === days ? "bg-accent text-white dark:text-black" : "text-muted hover:bg-accent-soft"}`}>{days} days</Link>)}</nav>
    </div>
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" data-testid="dashboard-metrics">
      <Metric title="Customer questions" value={t.received} detail={change} />
      <Metric title="Agent answered" value={t.automatic} detail={t.received ? `${rate(t.automatic, t.received)}% of questions in this period` : "No questions recorded yet"} accent />
      <Metric title="Team answered" value={t.team} detail="Questions received in this period" />
      <Link href="/inbox" className="rounded-2xl border border-border p-4 hover:border-accent"><p className="text-xs text-muted">Awaiting your team</p><p className="my-2 text-3xl font-semibold" data-testid="dashboard-pending">{data.pending}</p><p className="text-xs text-accent">Go to My Agent →</p></Link>
    </div>
    <div className="rounded-2xl bg-accent-soft/40 p-4 text-sm" data-testid="dashboard-insight">{t.received ? <>Your agent answered <b>{t.automatic} of {t.received}</b> recorded questions without involving your team.</> : <>Your dashboard starts with the first question a customer asks your business agent.</>}</div>
    <section className="space-y-3 rounded-2xl border border-border p-4" aria-label="Questions over time">
      <div><h3 className="font-semibold">Questions over time</h3><p className="hint">Outcomes of questions received each day. Today is still in progress.</p></div>
      <div className="flex flex-wrap gap-x-4 gap-y-2 text-xs">{outcomes.map(([key, label]) => <span key={key} className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: colours[key] }} />{label}</span>)}</div>
      <svg viewBox="0 0 720 225" role="img" aria-label={`Daily recorded questions over ${data.days} days, grouped by outcome`} className="w-full">
        {[0, 1, 2, 3, 4].map((tick) => <g key={tick}><line x1="42" x2="696" y1={185 - tick * 40} y2={185 - tick * 40} stroke="currentColor" opacity=".1" /><text x="34" y={189 - tick * 40} textAnchor="end" fill="currentColor" fontSize="10" opacity=".6">{Math.round(maximum * tick / 4)}</text></g>)}
        {data.daily.map((d, i) => { let top = 185; return <g key={d.day}><title>{`${date(d.day)}: ${d.total} questions; ${d.automatic} agent, ${d.team} team, ${d.pending} awaiting team, ${d.unanswered} missed, ${d.closed} closed, ${d.redirected} redirected`}</title>{outcomes.map(([key]) => { const height = d[key] / maximum * 160; top -= height; return <rect key={key} x={48 + i * barWidth} y={top} width={Math.max(1, barWidth - 2)} height={height} rx="1" fill={colours[key]} />; })}</g>; })}
        {[0, Math.floor((data.daily.length - 1) / 2), data.daily.length - 1].map((i) => <text key={i} x={48 + i * barWidth} y="211" textAnchor={i === 0 ? "start" : i === data.daily.length - 1 ? "end" : "middle"} fill="currentColor" fontSize="11" opacity=".6">{date(data.daily[i].day).replace(/ \d{4}$/, "")}</text>)}
      </svg>
      {!t.received && <p className="hint">No recorded questions in this period.</p>}
      <details><summary className="cursor-pointer text-xs text-accent">View daily figures</summary><div className="mt-2 overflow-x-auto"><table className="w-full text-left text-xs"><caption className="sr-only">Daily question outcomes in UTC</caption><thead><tr>{["Date", "Questions", "Agent", "Team", "Waiting", "Missed", "Closed", "Redirected"].map((label) => <th key={label} className="p-2">{label}</th>)}</tr></thead><tbody>{data.daily.map((d) => <tr key={d.day} className="border-t border-border"><th className="p-2 font-normal">{date(d.day)}</th>{[d.total,d.automatic,d.team,d.pending,d.unanswered,d.closed,d.redirected].map((value,i) => <td key={i} className="p-2">{value}</td>)}</tr>)}</tbody></table></div></details>
      <p className="hint">Each question has one outcome. Closed and redirected questions are excluded from missed questions.</p>
    </section>
    <div className="grid gap-4 lg:grid-cols-2">
      <section className="rounded-2xl border border-border p-4" aria-label="What customers ask most"><h3 className="font-semibold">What customers ask most</h3><p className="hint mb-4">Repeated wording is grouped, ignoring mentions, punctuation and capitalisation.</p>{data.questions.length ? <ol className="space-y-4">{data.questions.map((q,i) => <li key={q.question}><div className="flex gap-3 text-sm"><span className="text-muted">{i+1}</span><span className="min-w-0 flex-1 break-words">{q.question}</span><b>{q.asked}</b></div><div className="my-2 h-1.5 overflow-hidden rounded-full bg-accent-soft"><div className="h-full rounded-full bg-accent" style={{ width: `${q.asked / data.questions[0].asked * 100}%` }} /></div><p className="text-xs text-muted">{q.automatic} agent answered · {q.needed_team} reached your team</p></li>)}</ol> : <p className="hint">Recurring questions will appear as customers ask them.</p>}{data.unlabelled > 0 && <p className="hint mt-3">{data.unlabelled} recorded requests have no saved question text and are included only in the totals.</p>}</section>
      <section className="flex self-start flex-col rounded-2xl border border-border p-4" aria-label="Knowledge opportunities">
        <h3 className="font-semibold">Help your agent answer more</h3>
        <p className="hint mt-1">Keep approved answers up to date.</p>
        <SectionLink id="questions-answers" className="btn-primary mt-3 self-start">Questions &amp; Answers</SectionLink>
        <dl className="my-5 grid gap-2" data-testid="question-outcomes">
          <div className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1 rounded-xl bg-accent-soft/30 px-4 py-3"><dt className="whitespace-nowrap text-xs font-semibold">Approved answers</dt><dd className="text-2xl font-semibold">{approvedAnswers}</dd><dd className="col-span-2 text-xs text-muted">Updated in Questions &amp; Answers</dd></div>
          <div className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1 rounded-xl bg-accent-soft/30 px-4 py-3"><dt className="whitespace-nowrap text-xs font-semibold">Missed questions</dt><dd className="text-2xl font-semibold" data-testid="outcome-missed">{t.unanswered}</dd><dd className="col-span-2 text-xs text-muted">No answer from your agent or team.</dd></div>
          <div className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1 rounded-xl bg-accent-soft/30 px-4 py-3"><dt className="whitespace-nowrap text-xs font-semibold">Closed questions</dt><dd className="text-2xl font-semibold" data-testid="outcome-closed">{t.closed}</dd><dd className="col-span-2 text-xs text-muted">Declined, refused or cancelled.</dd></div>
          <div className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1 rounded-xl bg-accent-soft/30 px-4 py-3"><dt className="whitespace-nowrap text-xs font-semibold">Redirected</dt><dd className="text-2xl font-semibold" data-testid="outcome-redirected">{t.redirected}</dd><dd className="col-span-2 text-xs text-muted">Directed elsewhere or asked to clarify.</dd></div>
        </dl>
      </section>
    </div>
    <section className="space-y-4 rounded-2xl border border-border p-4" aria-label="Customer action clicks">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><h3 className="font-semibold">Customer action clicks</h3><p className="hint mt-1">Customer clicks on your published buttons. Your own test clicks are excluded.</p></div>
        <SectionLink id="book-or-order" className="btn-primary">Customer actions</SectionLink>
      </div>
      <div className="flex items-baseline gap-2"><strong className="text-4xl" data-testid="action-click-total">{clickTotal}</strong><span className="text-sm text-muted">recorded clicks</span></div>
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">{channels.map((channel) => <div key={channel.label} className="rounded-xl border border-border p-3"><dt className="text-xs text-muted"><span aria-hidden>{channel.icon}</span> {channel.label}</dt><dd className="mt-2 text-2xl font-semibold">{channel.count}</dd></div>)}</dl>
      {!clickTotal && <p className="hint">No customer clicks recorded for this period.</p>}
      {data.clicks.length > 0 && <details><summary className="cursor-pointer text-sm text-accent">Breakdown by button</summary><ul className="mt-3 space-y-3">{data.clicks.map((c) => <li key={`${c.kind}:${c.label}`}><div className="mb-1 flex justify-between gap-3 text-sm"><span className="break-words">{c.label}</span><b>{c.clicks}</b></div><div className="h-2 rounded-full bg-accent-soft"><div className="h-full rounded-full bg-accent" style={{ width: `${c.clicks / data.clicks[0].clicks * 100}%` }} /></div></li>)}</ul></details>}
      <div className="flex flex-wrap justify-between gap-2 text-xs text-muted"><span>Customer clicks are counted. Completed bookings and calls aren&apos;t tracked.</span><span>Tracking since {date(data.tracking_since)}</span></div>
    </section>
  </section>;
}

function Metric({ title,value,detail,accent=false }: { title:string;value:number;detail:string;accent?:boolean }) {
  return <div className={`rounded-2xl border p-4 ${accent ? "border-accent/40 bg-accent-soft/20" : "border-border"}`}><p className="text-xs text-muted">{title}</p><p className="my-2 text-3xl font-semibold">{value}</p><p className="text-xs text-muted">{detail}</p></div>;
}
