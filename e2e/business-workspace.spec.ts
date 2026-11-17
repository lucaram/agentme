import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { config } from "dotenv";
import { planBusinessFixture } from "../tests/fixtures/plan-business";

config({ path: ".env.local", quiet: true });
const open = async (page: Page, id: string) => { const section = page.getByTestId(id); if (await section.getAttribute("open") === null) await section.locator("summary").first().click(); return section; };
const send = async (page: Page, message: string) => { await page.getByLabel("Message", { exact: true }).fill(message); await page.getByRole("button", { name: "Send", exact: true }).click(); };

test("business workspace preserves agent information, custom actions, documents and staff replies", async ({ browser, baseURL }) => {
  test.setTimeout(180_000);
  const f = await planBusinessFixture();
  const documentUrl = `${baseURL!.replace("localhost", "127.0.0.1")}/demo/trattoria-menu.html`;
  const sessions: BrowserContext[] = [];
  const login = async (email: string) => {
    const context = await browser.newContext(); sessions.push(context);
    const page = await context.newPage();
    await page.goto("/login"); await page.getByLabel("Email", { exact: true }).fill(email); await page.getByLabel("Password", { exact: true }).fill(f.password);
    await page.getByRole("button", { name: "Log in", exact: true }).click(); await expect(page).toHaveURL(/\/chats/); return page;
  };
  try {
    await f.db.from("agents").update({ business_info: { ...f.business.agent.business_info as object, customers: "Private events: members-only pricing of 9876 pounds.", website: `${baseURL}/demo/trattoria-menu.html` } }).eq("id", f.business.agent.id);
    const { error: noticeError } = await f.db.from("notices").insert({ user_id: f.business.userId, area: "business", kind: "site_change", text: "Your website has an informational update." });
    if (noticeError) throw noticeError;
    const shop = await login(f.business.email);
    // Informational website updates don't count as customer questions needing a reply.
    await expect(shop.getByTestId("business-badge")).toHaveCount(0);
    await shop.goto("/business");
    const sectionTitles = await shop.getByTestId("business-sections").locator(":scope > details > summary").allTextContents();
    expect(sectionTitles).toHaveLength(7);
    for (const [i, title] of ["Customer dashboard", "About your business", "Business information", "Website & documents", "Questions & Answers", "Staff & access", "Share your business"].entries()) expect(sectionTitles[i]).toContain(title);
    await expect(shop.getByTestId("fold-faqs-badge")).toHaveCount(0);
    await expect(shop.getByTestId("fold-faqs").locator("summary")).toContainText("2 approved answers");
    await expect(shop.getByRole("link", { name: /questions? awaiting your team/ })).toHaveCount(0);
    await expect(shop.locator("details[open]")).toHaveCount(0);
    await expect(shop.getByRole("button", { name: "Test your agent", exact: true })).toBeVisible();
    await expect(shop.getByText("What your agent knows", { exact: true })).toHaveCount(0);
    const introduction = `A friendly independent Italian restaurant.\n${"We serve carefully prepared seasonal dishes. ".repeat(10)}`;
    const about = await open(shop, "fold-own-words");
    await about.getByRole("textbox", { name: /About your business/ }).fill(introduction);
    await about.getByRole("button", { name: "Save description" }).click();
    await expect(about.getByRole("status")).toContainText("Saved");
    const afterAbout = (await f.db.from("agents").select("business_info").eq("id", f.business.agent.id).single()).data!.business_info as { customers: string; faqs: unknown[] };
    expect(afterAbout.customers).toContain("9876"); expect(afterAbout.faqs).toHaveLength(2);

    await shop.getByRole("button", { name: "Test your agent", exact: true }).click();
    const preview = shop.getByRole("dialog", { name: "Test your agent" });
    await preview.getByLabel("Test question").fill("Do you do private events?");
    await preview.getByRole("button", { name: "See the answer" }).click();
    await expect(preview.getByTestId("try-answer")).not.toContainText("9876");
    await preview.getByRole("checkbox", { name: /Ask as one of my customers/ }).check();
    await preview.getByRole("button", { name: "See the answer" }).click();
    await expect(preview.getByTestId("try-answer")).toContainText("9876");
    await preview.getByRole("button", { name: "Close agent preview" }).click();
    expect((await f.db.from("task_exchanges").select("id").eq("to_agent", f.business.agent.id)).data).toEqual([]);

    const information = await open(shop, "fold-book");
    await information.getByLabel("Opening hours", { exact: true }).fill("Tuesday to Sunday 12–23, closed Mondays.");
    await information.getByLabel("Business address").fill("12 Public Street, Camden");
    await information.getByRole("button", { name: "Save business details" }).click();
    await expect(information.getByRole("status")).toContainText("Saved");
    const actions = [
      { kind: "book", value: "https://sole.example/book", label: "Book a table" },
      { kind: "order", value: "https://sole.example/order", label: "Order food" },
      { kind: "call", value: "020 7946 0000", label: "Call restaurant" },
      { kind: "whatsapp", value: "+44 7700 900123", label: "WhatsApp restaurant" },
      { kind: "email", value: "hello@sole.example", label: "Email restaurant" },
      { kind: "website", value: "https://sole.example/", label: "Visit website" },
      { kind: "custom", value: "https://sole.example/events", label: "Request catering", purpose: "book" },
      { kind: "call", value: "020 7946 1111", label: "Call events team" },
      { kind: "custom", value: "https://sole.example/brochure", label: "Download brochure", purpose: "information" },
    ];
    for (let i = 0; i < actions.length; i++) {
      if (await information.getByTestId("way-row").count() <= i) await information.getByRole("button", { name: /Add another way/ }).click();
      await information.getByLabel(`Way ${i + 1}: what is it`, { exact: true }).selectOption(actions[i].kind);
      await information.getByLabel(`Way ${i + 1}: link or number`, { exact: true }).fill(actions[i].value);
      await information.getByLabel(`Way ${i + 1}: button label`, { exact: true }).fill(actions[i].label);
      if (actions[i].kind === "custom") await information.getByLabel(`Way ${i + 1}: purpose`, { exact: true }).selectOption(actions[i].purpose!);
    }
    await information.getByTestId("way-row").nth(6).getByRole("checkbox", { name: "Feature this button" }).check();
    await information.getByRole("button", { name: "Save customer actions" }).click();
    await expect(information.getByRole("status").filter({ hasText: "Saved. Your agent" })).toBeVisible();
    expect(((await f.db.from("agents").select("business_info").eq("id", f.business.agent.id).single()).data!.business_info as { ways: unknown[] }).ways).toHaveLength(9);

    const docs = await open(shop, "fold-documents");
    await expect(docs.getByLabel("Your website", { exact: true })).toHaveValue(`${baseURL}/demo/trattoria-menu.html`);
    await expect(docs.getByRole("button", { name: "Retry connection", exact: true })).toBeVisible();
    await docs.getByLabel("Link to read").fill(documentUrl);
    await docs.getByRole("checkbox", { name: /Also show customers a button/ }).check();
    await docs.getByLabel("New document button label").fill("View menu");
    await docs.getByRole("button", { name: "Add link", exact: true }).click();
    await expect(docs.getByTestId("business-source")).toHaveCount(1);
    await expect(docs.getByText("Customer button: View menu. Edit it in Business information.")).toBeVisible();

    // Reuse a connected website after review, record successful checks and pause daily updates.
    // The saved address survives a fresh visit without signup query parameters.
    await shop.goto("/chats");
    await shop.goto("/business");
    await open(shop, "fold-documents");
    await expect(docs.getByLabel("Your website", { exact: true })).toHaveValue(`${baseURL}/demo/trattoria-menu.html`);
    await docs.getByRole("button", { name: "Retry connection", exact: true }).click();
    await expect(shop).toHaveURL(/\/business\/setup/);
    await shop.getByRole("button", { name: /Go live/ }).click();
    await expect(shop).toHaveURL(/\/business\?live=1/);
    await open(shop, "fold-documents");
    await expect(docs.getByTestId("website-card")).toContainText("Last successful check:");
    await expect(docs.getByTestId("website-card")).not.toContainText("not recorded yet");
    await expect(docs.getByRole("button", { name: "Read my website", exact: true })).toHaveCount(0);
    await expect(docs.getByRole("button", { name: "Retry connection", exact: true })).toHaveCount(0);
    await docs.getByRole("checkbox", { name: /Automatic website updates/ }).uncheck();
    await expect.poll(async () => (await f.db.from("business_sites").select("auto_refresh").eq("agent_id", f.business.agent.id).single()).data?.auto_refresh).toBe(false);

    const visitor = await browser.newContext(); sessions.push(visitor);
    const publicPage = await visitor.newPage(); await publicPage.goto(`/u/${f.business.agent.handle}`);
    await expect(publicPage.getByText(introduction.trim(), { exact: true })).toBeVisible();
    await expect(publicPage.getByText("Tuesday to Sunday 12–23, closed Mondays.", { exact: false })).toBeVisible();
    await expect(publicPage.locator("body")).not.toContainText("9876");
    await expect(publicPage.getByRole("link", { name: /Request catering/ })).toBeVisible();
    await publicPage.getByText(/More options \(/).click();
    await expect(publicPage.getByRole("link", { name: /Download brochure/ })).toHaveAttribute("href", "https://sole.example/brochure");
    await expect(publicPage.getByRole("link", { name: /View menu/ })).toHaveAttribute("href", documentUrl);
    await expect(publicPage.getByTestId("business-ways").getByRole("link")).toHaveCount(10);

    await visitor.route("https://sole.example/**",route=>route.fulfill({body:"Booking website",contentType:"text/html"}));
    const recorded=publicPage.waitForResponse(response=>response.url().endsWith("/api/business/actions/click"));
    const popup=visitor.waitForEvent("page");
    await publicPage.getByRole("link",{name:/Request catering/}).click();
    expect((await recorded).status()).toBe(204);
    await (await popup).close();
    await expect.poll(async()=>(await f.db.from("business_action_events").select("id").eq("agent_id",f.business.agent.id)).data?.length).toBe(1);
    const call=publicPage.getByRole("link",{name:/Call restaurant/});
    await expect(call).toHaveAttribute("href","tel:02079460000");
    // Prevent launching the operating system's phone app while exercising the real click handler.
    await publicPage.evaluate(()=>document.addEventListener("click",event=>{if((event.target as Element).closest('a[href^="tel:"]'))event.preventDefault();},{capture:true}));
    const callRecorded=publicPage.waitForResponse(response=>response.url().endsWith("/api/business/actions/click"));
    await call.click();
    expect((await callRecorded).status()).toBe(204);
    await expect.poll(async()=>(await f.db.from("business_action_events").select("id").eq("agent_id",f.business.agent.id)).data?.length).toBe(2);

    const luca = await login(f.luca.email); await luca.goto(`/chats/${f.direct}`);
    await send(luca, "How do I book a table?");
    const messages = luca.getByRole("list", { name: "Messages", exact: true });
    await expect(messages).toContainText("https://sole.example/events");
    await expect(messages).not.toContainText("https://sole.example/brochure");
    await expect(messages).not.toContainText("9876");
    await send(luca, "Can you securely store four bicycles indoors?");
    await luca.getByRole("button", { name: "Ask the team", exact: true }).click();
    await expect(luca.getByRole("status").filter({ hasText: "Sent to the team" })).toBeVisible();
    // The dashboard reports the pending workload; customer replies live only in My Agent.
    await expect(shop.getByTestId("business-badge")).toHaveCount(0);
    await expect(shop.getByTestId("fold-activity-badge")).toHaveCount(0);
    await expect(shop.getByTestId("inbox-item")).toHaveCount(0);
    await open(shop, "fold-activity");
    const dashboard=shop.getByTestId("customer-dashboard");
    await expect(dashboard.getByTestId("dashboard-pending")).toHaveText("1");
    const clickStats=dashboard.getByRole("region",{name:"Customer action clicks",exact:true});
    await expect(clickStats.getByTestId("action-click-total")).toHaveText("2");
    await expect(clickStats).toContainText("Your own test clicks are excluded");
    await clickStats.getByRole("link",{name:"Customer actions",exact:true}).click();
    await expect(shop.getByTestId("fold-book")).toHaveAttribute("open","");
    await expect(shop.getByRole("heading",{name:"Customer actions",exact:true})).toBeInViewport();
    await open(shop,"fold-activity");
    const knowledge=dashboard.getByRole("region",{name:"Knowledge opportunities",exact:true});
    await expect(knowledge.getByRole("list")).toHaveCount(0);
    for(let visit=0;visit<2;visit++) {
      await knowledge.getByRole("link",{name:"Questions & Answers",exact:true}).click();
      await expect(shop.getByTestId("fold-faqs")).toHaveAttribute("open","");
      await expect(shop.getByTestId("fold-faqs").locator("summary")).toBeFocused();
      await expect(shop.getByTestId("fold-faqs").locator("summary")).toBeInViewport();
      await open(shop,"fold-activity");
    }
    await expect(dashboard.getByRole("img", { name: /Daily recorded questions/ })).toBeVisible();
    await dashboard.getByRole("link",{name:/7 days/}).click();
    await expect(dashboard.getByRole("link",{name:"7 days",exact:true})).toHaveAttribute("aria-current","page");
    await expect(dashboard.getByTestId("dashboard-pending")).toHaveText("1");
    await dashboard.getByRole("link",{name:/Go to My Agent/}).click();
    await expect(shop).toHaveURL(/\/chats\/[0-9a-f-]+$/);
    const item=shop.getByTestId("inbox-item").filter({hasText:"four bicycles"});
    await expect(item).toBeVisible();
    await item.getByLabel(/Your answer/).fill("Yes, we can store four bicycles indoors during your meal.");
    await item.getByRole("button",{name:"Send answer",exact:true}).click();
    await expect(item).toHaveCount(0);
    await expect(messages).toContainText("The team at Trattoria Sole: Yes, we can store four bicycles");
    await shop.goto("/business#customer-dashboard");
    await expect(dashboard.getByTestId("dashboard-pending")).toHaveText("0");
    await expect(shop.getByTestId("inbox-item")).toHaveCount(0);
    await expect(dashboard.getByTestId("dashboard-insight")).toContainText("1 of 2");

    await send(luca,"Can you securely store a folding kayak indoors?");
    await luca.getByRole("button",{name:"Ask the team",exact:true}).click();
    await expect(dashboard.getByTestId("dashboard-pending")).toHaveText("1");
    await shop.goto("/inbox");
    const declined=shop.getByTestId("inbox-item").filter({hasText:"folding kayak"});
    await declined.getByRole("button",{name:"We don't know",exact:true}).click();
    await expect(declined).toHaveCount(0);
    await shop.goto("/business#customer-dashboard");
    await expect(dashboard.getByTestId("dashboard-pending")).toHaveText("0");
    await expect(dashboard.getByTestId("outcome-missed")).toHaveText("0");
    await expect(dashboard.getByTestId("outcome-closed")).toHaveText("1");
    await expect(dashboard.getByTestId("outcome-redirected")).toHaveText("0");

    await send(luca,"What is the weather in Falkirk?");
    await expect(messages).toContainText("Your personal agent can help with that question.");
    await expect(luca.getByRole("button",{name:"Ask the team",exact:true})).toHaveCount(0);
    await expect(dashboard.getByTestId("outcome-redirected")).toHaveText("1");
    await expect(dashboard.getByTestId("outcome-missed")).toHaveText("0");
    await expect(dashboard.getByTestId("outcome-closed")).toHaveText("1");
    await dashboard.getByText("View daily figures",{exact:true}).click();
    await expect(dashboard.getByRole("columnheader",{name:"Closed",exact:true})).toBeVisible();
    await expect(dashboard.getByRole("columnheader",{name:"Redirected",exact:true})).toBeVisible();

    // Deliberately disconnecting also clears the saved signup address.
    await open(shop, "fold-documents");
    shop.once("dialog", (dialog) => dialog.accept());
    await docs.getByTestId("website-card").getByRole("button", { name: "Remove", exact: true }).click();
    await expect(docs.getByLabel("Your website", { exact: true })).toHaveValue("");
    await shop.reload();
    await open(shop, "fold-documents");
    await expect(docs.getByLabel("Your website", { exact: true })).toHaveValue("");
  } finally {
    for (const session of sessions) await session.close();
    await f.cleanup();
  }
});
