import { expect, test, type BrowserContext, type Locator, type Page } from "@playwright/test";
import { config } from "dotenv";
import sharp from "sharp";
import { planBusinessFixture } from "../tests/fixtures/plan-business";

config({ path: ".env.local", quiet: true });

function silentWav() {
  const wav = Buffer.alloc(44 + 34000);
  wav.write("RIFF"); wav.writeUInt32LE(wav.length - 8, 4); wav.write("WAVEfmt ", 8); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(16000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write("data", 36); wav.writeUInt32LE(34000, 40);
  return wav;
}

test("chat previews keep emoji, files, location and polls private until Send; media access follows membership", async ({ browser }) => {
  test.setTimeout(180000);
  const f = await planBusinessFixture(); const sessions: BrowserContext[] = [];
  async function login(email: string) {
    const context = await browser.newContext({ permissions: ["geolocation", "camera", "microphone"], geolocation: { latitude: 56.001, longitude: -3.784, accuracy: 15 } }); sessions.push(context);
    const page = await context.newPage(); await page.goto("/login"); await page.getByLabel("Email", { exact: true }).fill(email); await page.getByLabel("Password", { exact: true }).fill(f.password); await page.getByRole("button", { name: "Log in", exact: true }).click(); await expect(page).toHaveURL(/\/chats/); return page;
  }
  async function attach(page: Page, name: string, mimeType: string, buffer: Buffer) {
    await page.getByRole("button", { name: "Attach", exact: true }).click();
    const chooser = page.waitForEvent("filechooser"); await page.getByRole("button", { name: /Photos & files/ }).click();
    await (await chooser).setFiles({ name, mimeType, buffer });
    await expect(page.getByTestId("attachment-preview")).toBeVisible();
  }
  const send = (page: Page) => page.getByRole("button", { name: "Send", exact: true }).click();
  const messageBox = (page: Page) => page.getByRole("textbox", { name: "Message", exact: true });
  async function expectCaption(messages: Locator, caption: string) {
    await expect(messages.getByText(caption, { exact: true })).toBeVisible();
    const bubble = messages.locator("[data-message-bubble]").filter({ hasText: caption });
    await expect(bubble).toHaveCount(1);
    const media = bubble.getByTestId("message-media"); const captionElement = bubble.getByTestId("attachment-caption");
    await expect(media).toBeVisible(); await expect(captionElement).toHaveText(caption);
    // Measure in one frame: separate calls can straddle scroll anchoring or media resizing.
    const { bounds, mediaBounds, captionBounds } = await bubble.evaluate((el) => ({
      bounds: el.getBoundingClientRect().toJSON(),
      mediaBounds: el.querySelector('[data-testid="message-media"]')!.getBoundingClientRect().toJSON(),
      captionBounds: el.querySelector('[data-testid="attachment-caption"]')!.getBoundingClientRect().toJSON(),
    }));
    expect(mediaBounds!.y).toBeGreaterThanOrEqual(bounds!.y);
    expect(mediaBounds!.x).toBeGreaterThanOrEqual(bounds!.x);
    expect(mediaBounds!.x + mediaBounds!.width).toBeLessThanOrEqual(bounds!.x + bounds!.width);
    expect(mediaBounds!.y + mediaBounds!.height).toBeLessThanOrEqual(captionBounds!.y);
    expect(captionBounds!.y + captionBounds!.height).toBeLessThanOrEqual(bounds!.y + bounds!.height);
    const { data: posted } = await f.db.from("messages").select("id,metadata").eq("conversation_id", f.group).eq("sender_user_id", f.luca.userId).eq("content", caption).single();
    expect(posted).toBeTruthy();
    const { data: files } = await f.db.from("chat_attachments").select("id").eq("message_id", posted!.id);
    expect(files).toHaveLength(1);
  }
  async function checkAudioProgress(player: Locator) {
    await player.page().bringToFront();
    const slider = player.getByRole("slider", { name: "Seek voice message", exact: true });
    await player.getByRole("button", { name: "1×", exact: true }).click();
    await player.getByRole("button", { name: "Play voice message", exact: true }).click();
    await expect.poll(() => player.locator("audio").evaluate((audio: HTMLAudioElement) => audio.currentTime)).toBeGreaterThan(0);
    // Sample painted values: playback must move between the browser's sparse timeupdate events.
    const samples = await slider.evaluate((input: HTMLInputElement) => new Promise<number[]>((resolve) => {
      const values: number[] = []; const start = performance.now();
      const sample = () => { values.push(Number(input.value)); if (performance.now() - start < 600) requestAnimationFrame(sample); else resolve(values); };
      requestAnimationFrame(sample);
    }));
    expect(new Set(samples).size).toBeGreaterThan(8);
    expect(samples.every((value, i) => i === 0 || value >= samples[i - 1])).toBe(true);
    await player.getByRole("button", { name: "Pause voice message", exact: true }).click();
    const paused = Number(await slider.inputValue());
    expect(paused).toBeGreaterThan(0); expect(paused).toBeLessThan(100);
    await player.getByRole("button", { name: "4×", exact: true }).click();
    await player.getByRole("button", { name: "Play voice message", exact: true }).click();
    await expect(player.locator("audio")).toHaveJSProperty("ended", true);
    await expect(slider).toHaveValue("100");
    // Completion must stay at the end; replay starts a fresh pass.
    await player.getByRole("button", { name: "1×", exact: true }).click(); await expect(slider).toHaveValue("100");
    await player.getByRole("button", { name: "Play voice message", exact: true }).click();
    await expect.poll(async () => Number(await slider.inputValue())).toBeLessThan(100);
    await player.getByRole("button", { name: "Pause voice message", exact: true }).click();
  }
  try {
    const luca = await login(f.luca.email); await luca.goto(`/chats/${f.group}`);
    const marco = await login(f.marco.email); await marco.goto(`/chats/${f.group}`);
    const messages = marco.getByRole("list", { name: "Messages", exact: true });
    await luca.getByLabel("Message", { exact: true }).fill("Hello "); await luca.getByRole("button", { name: "Emojis", exact: true }).click(); await luca.getByRole("button", { name: "Emoji 😊", exact: true }).click();
    await expect(luca.getByLabel("Message", { exact: true })).toHaveValue("Hello 😊"); await send(luca); await expect(messages).toContainText("Hello 😊");

    const png = await sharp({ create: { width: 1600, height: 1000, channels: 3, background: "#44aa77" } }).png().toBuffer();
    await attach(luca, "draft.png", "image/png", png);
    expect((await f.db.from("chat_attachments").select("id").eq("conversation_id", f.group)).data).toHaveLength(0);
    await luca.getByRole("button", { name: /^Remove attachment/ }).click(); await expect(luca.getByTestId("attachment-preview")).toHaveCount(0);
    await messageBox(luca).click(); await messageBox(luca).pressSequentially("Here are the dinner notes.");
    await attach(luca, "dinner.txt", "text/plain", Buffer.from("Dinner notes for Luca and Marco."));
    await expect(messageBox(luca)).toBeFocused(); await expect(messageBox(luca)).toHaveValue("Here are the dinner notes.");
    await attach(luca, "extra-notes.txt", "text/plain", Buffer.from("Optional extra notes."));
    await expect(messageBox(luca)).toBeFocused(); await expect(messageBox(luca)).toHaveValue("Here are the dinner notes.");
    await luca.getByRole("button", { name: "Remove attachment extra-notes.txt", exact: true }).click();
    await expect(messageBox(luca)).toBeFocused(); await expect(messageBox(luca)).toHaveValue("Here are the dinner notes.");
    await messageBox(luca).press("End"); await messageBox(luca).press("Shift+Enter"); await messageBox(luca).pressSequentially("Let me know what you think.");
    await send(luca); const documentLink = messages.getByRole("link", { name: /dinner.txt/ }); await expect(documentLink).toBeVisible();
    await expectCaption(messages, "Here are the dinner notes.\nLet me know what you think.");
    const href = await documentLink.getAttribute("href"); const downloaded = await marco.request.get(href!); expect(downloaded.status()).toBe(200); expect(await downloaded.text()).toBe("Dinner notes for Luca and Marco."); expect(downloaded.headers()["content-disposition"]).toContain("attachment");
    const outsider = await login(f.business.email); expect((await outsider.request.get(href!)).status()).toBe(404);

    await luca.getByRole("button", { name: "Attach", exact: true }).click(); await luca.getByRole("button", { name: /Share location/ }).click(); await expect(luca.getByTestId("attachment-preview")).toContainText("No live tracking");
    await expect(marco.getByTestId("shared-location")).toHaveCount(0); await luca.getByRole("button", { name: "Remove location", exact: true }).click();
    await luca.getByRole("button", { name: "Attach", exact: true }).click(); await luca.getByRole("button", { name: /Share location/ }).click(); await expect(luca.getByTestId("attachment-preview")).toContainText("56.001"); await send(luca);
    await expect(marco.getByTestId("shared-location")).toHaveAttribute("href", "https://www.google.com/maps/search/?api=1&query=56.001,-3.784");

    await luca.getByRole("button", { name: "Attach", exact: true }).click(); await luca.getByRole("button", { name: /Create poll/ }).click();
    const pollEditor = luca.getByRole("dialog", { name: "Create poll", exact: true }); await pollEditor.getByLabel("Question", { exact: true }).fill("Pizza or sushi?"); await pollEditor.getByLabel("Poll option 1", { exact: true }).fill("Pizza"); await pollEditor.getByLabel("Poll option 2", { exact: true }).fill("Sushi"); await pollEditor.getByRole("button", { name: "Review poll", exact: true }).click();
    await expect(marco.getByTestId("poll")).toHaveCount(0); await expect(luca.getByTestId("attachment-preview")).toContainText("Pizza or sushi?"); await send(luca);
    await expect(marco.getByTestId("poll")).toBeVisible(); await marco.getByTestId("poll").getByRole("button", { name: "Pizza", exact: true }).click(); await expect(luca.getByTestId("poll").getByRole("list", { name: "Votes for Pizza", exact: true })).toContainText("Marco");

    // Existing audio files also show their length before playing, and remain removable drafts.
    await attach(luca, "audio-preview.wav", "audio/wav", silentWav());
    const preview = luca.getByTestId("attachment-preview");
    await expect(preview.getByTestId("voice-duration")).toHaveText("0:02");
    await expect(preview.locator("audio")).toHaveJSProperty("paused", true);
    await expect(preview.locator("audio")).toHaveJSProperty("currentTime", 0);
    await expect(marco.getByTestId("voice-message")).toHaveCount(0);
    await checkAudioProgress(preview.getByTestId("voice-message"));
    await luca.getByRole("button", { name: "Remove attachment audio-preview.wav", exact: true }).click(); await expect(preview).toHaveCount(0);

    // Real browser encoders, but synthetic devices: no user's camera or microphone is used.
    await luca.getByRole("button", { name: "Record audio", exact: true }).click();
    const voice = luca.getByRole("dialog", { name: "Record voice message", exact: true }); await voice.getByRole("button", { name: "Start recording", exact: true }).click(); await expect(voice.getByRole("status")).toContainText("0:03"); await voice.getByRole("button", { name: "Stop & review", exact: true }).click();
    await expect(preview.getByTestId("voice-message")).toBeVisible(); await expect(preview.getByTestId("voice-duration")).toHaveText(/0:0[1-9]/);
    await expect(messageBox(luca)).toBeFocused();
    await expect(preview.locator("audio")).toHaveJSProperty("paused", true); await expect(preview.locator("audio")).toHaveJSProperty("currentTime", 0);
    await checkAudioProgress(preview.getByTestId("voice-message"));
    await messageBox(luca).click(); await messageBox(luca).pressSequentially("Here is my voice note.");
    await expect(marco.getByTestId("voice-message")).toHaveCount(0); await send(luca);
    await expectCaption(messages, "Here is my voice note.");
    const audio = marco.getByTestId("voice-message"); await expect(audio).toBeVisible();
    await expect(audio.getByTestId("voice-duration")).toHaveText(/0:0[1-9]/);
    await expect(audio.locator("audio")).toHaveJSProperty("paused", true);
    await expect(audio.locator("audio")).toHaveJSProperty("currentTime", 0);
    await checkAudioProgress(audio);
    await audio.getByRole("button", { name: "2×", exact: true }).click(); await expect(audio.locator("audio")).toHaveJSProperty("playbackRate", 2); await audio.getByRole("button", { name: "4×", exact: true }).click(); await expect(audio.locator("audio")).toHaveJSProperty("playbackRate", 4);
    await expect.poll(() => audio.locator("audio").evaluate((el: HTMLAudioElement) => el.readyState)).toBeGreaterThan(0);
    await audio.getByRole("slider", { name: "Seek voice message", exact: true }).focus(); await audio.getByRole("slider").press("ArrowRight");
    await expect.poll(() => audio.locator("audio").evaluate((el: HTMLAudioElement) => el.currentTime)).toBeGreaterThan(0);
    await expect(audio.locator("audio")).toHaveJSProperty("paused", true);
    await audio.getByRole("slider").press("Home"); await audio.getByRole("button", { name: "1×", exact: true }).click();
    await audio.getByRole("button", { name: "Play voice message", exact: true }).click(); await expect(audio.getByRole("button", { name: "Pause voice message", exact: true })).toBeVisible(); await audio.getByRole("button", { name: "Pause voice message", exact: true }).click();
    await expect(audio.locator("audio")).toHaveJSProperty("paused", true);

    await luca.getByRole("button", { name: "Attach", exact: true }).click(); await luca.getByRole("button", { name: /Camera/ }).click();
    const camera = luca.getByRole("dialog", { name: "Camera", exact: true }); await expect.poll(() => camera.locator("video").evaluate((el: HTMLVideoElement) => el.videoWidth)).toBeGreaterThan(0); await camera.getByRole("button", { name: "Take photo", exact: true }).click(); await expect(luca.getByTestId("attachment-preview").locator("img")).toBeVisible();
    await expect(messageBox(luca)).toBeFocused(); await messageBox(luca).pressSequentially("Here is the photo."); await send(luca); await expectCaption(messages, "Here is the photo.");
    const ownPhotoBubble = luca.getByRole("list", { name: "Messages", exact: true }).locator("[data-message-bubble]").filter({ hasText: "Here is the photo." });
    await expect(ownPhotoBubble).toHaveClass(/bg-accent/);
    await expect(ownPhotoBubble.getByRole("img")).toBeVisible(); await expect(ownPhotoBubble.getByTestId("attachment-caption")).toHaveText("Here is the photo.");
    await ownPhotoBubble.scrollIntoViewIfNeeded(); await ownPhotoBubble.screenshot({ path: "test-results/photo-caption-bubble.png" });
    const photo = messages.getByRole("img", { name: /^Photo-/ }); await photo.scrollIntoViewIfNeeded(); await expect.poll(() => photo.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBeGreaterThan(0);
    await luca.getByRole("button", { name: "Attach", exact: true }).click(); await luca.getByRole("button", { name: /Camera/ }).click(); await camera.getByRole("button", { name: "Record video", exact: true }).click();
    await expect(camera.getByRole("status")).toContainText("0:01"); await camera.getByRole("button", { name: "Stop & review", exact: true }).click(); await expect(luca.getByTestId("attachment-preview").locator("video")).toBeVisible();
    await expect(messageBox(luca)).toBeFocused(); await messageBox(luca).pressSequentially("Here is the video."); await send(luca); await expectCaption(messages, "Here is the video.");
    const video = messages.locator("video"); await video.scrollIntoViewIfNeeded(); await expect.poll(() => video.evaluate((el: HTMLVideoElement) => el.readyState)).toBeGreaterThan(0);

    // Navigating to another chat discards drafts instead of carrying private files/location along.
    await attach(luca, "private-draft.txt", "text/plain", Buffer.from("Private unsent draft")); await luca.goto(`/chats/${f.direct}`); await expect(luca.getByTestId("attachment-preview")).toHaveCount(0);
    await marco.setViewportSize({ width: 390, height: 844 }); await marco.getByRole("button", { name: "Attach", exact: true }).click(); await expect(marco.getByRole("region", { name: "Attachment menu", exact: true })).toBeVisible(); expect(await marco.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); await marco.screenshot({ path: "test-results/chat-media-mobile.png", fullPage: true });
    await marco.reload(); await expect(marco.getByTestId("voice-message")).toBeVisible(); await expect(marco.getByTestId("voice-duration")).toHaveText(/0:0[1-9]/); await expect(marco.getByTestId("voice-message").locator("audio")).toHaveJSProperty("paused", true); await expect(marco.getByTestId("shared-location")).toBeVisible();
  } finally {
    for (const session of sessions) await session.close();
    const { data: objects } = await f.db.from("chat_attachments").select("path").eq("uploader_id", f.luca.userId);
    const paths = (objects ?? []).map((o) => o.path);
    const removed = paths.length ? await f.db.storage.from("chat-attachments").remove(paths) : { error: null };
    await f.cleanup();
    if (!removed.error && paths.length) await f.db.from("chat_attachment_gc").delete().in("path", paths);
  }
});

test("My Agent keeps files private and creates a poll with explicitly selected contacts", async ({ browser }) => {
  const f = await planBusinessFixture(); const sessions: BrowserContext[] = [];
  const login = async (email: string) => {
    const context = await browser.newContext(); sessions.push(context); const page = await context.newPage(); await page.goto("/login"); await page.getByLabel("Email", { exact: true }).fill(email); await page.getByLabel("Password", { exact: true }).fill(f.password); await page.getByRole("button", { name: "Log in", exact: true }).click(); await expect(page).toHaveURL(/\/chats/); return page;
  };
  try {
    await f.db.from("contacts").insert({ requester_agent: f.luca.agent.id, addressee_agent: f.marco.agent.id, status: "accepted" });
    const luca = await login(f.luca.email); await luca.goto(`/chats/${f.myAgent}?t=new`);
    await luca.getByLabel("Choose attachments", { exact: true }).setInputFiles({ name: "private.txt", mimeType: "text/plain", buffer: Buffer.from("Owner's private note.") });
    await expect(luca.getByTestId("attachment-preview")).toBeVisible();
    const privateCaption = luca.getByRole("textbox", { name: "Message", exact: true }); await expect(privateCaption).toBeFocused(); await privateCaption.pressSequentially("A private note for this request.");
    await luca.getByRole("button", { name: "Send", exact: true }).click();
    const note = luca.getByRole("link", { name: /private.txt/ }); await expect(note).toBeVisible();
    await expect(luca.getByRole("list", { name: "Messages", exact: true }).getByText("A private note for this request.", { exact: true })).toBeVisible();
    const { data: privateMessage } = await f.db.from("messages").select("id").eq("conversation_id", f.myAgent).eq("content", "A private note for this request.").single();
    expect((await f.db.from("chat_attachments").select("id").eq("message_id", privateMessage!.id)).data).toHaveLength(1);
    const paul = await login(f.paul.email); expect((await paul.request.get((await note.getAttribute("href"))!)).status()).toBe(404);
    await luca.goto(`/chats/${f.myAgent}?t=new`); await luca.getByRole("button", { name: "Attach", exact: true }).click(); await luca.getByRole("button", { name: /Create poll/ }).click();
    const editor = luca.getByRole("dialog", { name: "Create poll", exact: true }); await editor.getByLabel("Question", { exact: true }).fill("Friday lunch?"); await editor.getByLabel("Poll option 1", { exact: true }).fill("Yes"); await editor.getByLabel("Poll option 2", { exact: true }).fill("No"); await editor.getByRole("checkbox", { name: /^Marco/ }).check(); await editor.getByRole("button", { name: "Review poll", exact: true }).click();
    await expect(luca.getByTestId("attachment-preview")).toContainText("With: Marco"); await luca.getByRole("button", { name: "Send", exact: true }).click();
    await expect(luca.getByTestId("poll")).toContainText("Friday lunch?"); const groupLink = luca.getByRole("link", { name: "Open poll chat →", exact: true }); await expect(groupLink).toBeVisible(); const groupPath = await groupLink.getAttribute("href");
    const marco = await login(f.marco.email); await marco.goto(groupPath!); await expect(marco.getByRole("heading", { name: "404", exact: true })).toBeVisible();
    await marco.goto("/chats"); await marco.getByRole("link", { name: /My Agent/ }).first().click();
    await marco.getByRole("button", { name: "Join group", exact: true }).click();
    await expect(marco.getByTestId("poll")).toContainText("Friday lunch?"); await marco.getByTestId("poll").getByRole("button", { name: "Yes", exact: true }).click(); await expect(luca.getByTestId("poll").getByRole("list", { name: "Votes for Yes", exact: true })).toContainText("Marco");
    await paul.goto(groupPath!); await expect(paul.getByRole("heading", { name: "404", exact: true })).toBeVisible();
  } finally {
    for (const session of sessions) await session.close();
    const { data: objects } = await f.db.from("chat_attachments").select("path").eq("uploader_id", f.luca.userId); const paths = (objects ?? []).map((o) => o.path);
    const removed = paths.length ? await f.db.storage.from("chat-attachments").remove(paths) : { error: null }; await f.cleanup(); if (!removed.error && paths.length) await f.db.from("chat_attachment_gc").delete().in("path", paths);
  }
});

test("compact attachment cards scroll horizontally, expand photos and keep the caption and Send visible", async ({ browser }) => {
  const f = await planBusinessFixture(); const context = await browser.newContext();
  try {
    const page = await context.newPage(); await page.goto("/login"); await page.getByLabel("Email", { exact: true }).fill(f.luca.email); await page.getByLabel("Password", { exact: true }).fill(f.password); await page.getByRole("button", { name: "Log in", exact: true }).click(); await expect(page).toHaveURL(/\/chats/); await page.goto(`/chats/${f.group}`);
    const portrait = await sharp({ create: { width: 600, height: 900, channels: 3, background: "#578b72" } }).png().toBuffer();
    const landscape = await sharp({ create: { width: 1200, height: 600, channels: 3, background: "#527bb5" } }).png().toBuffer();
    const input = page.getByLabel("Choose attachments", { exact: true }); const caption = page.getByRole("textbox", { name: "Message", exact: true }); const send = page.getByRole("button", { name: "Send", exact: true });
    await caption.fill("Review these attachments together.");
    await input.setInputFiles({ name: "portrait.png", mimeType: "image/png", buffer: portrait });
    const preview = page.getByTestId("attachment-preview"); const cards = preview.getByTestId("attachment-card"); const thumbnail = preview.getByRole("img");
    await expect(cards).toHaveCount(1); await expect(caption).toBeFocused(); await expect(thumbnail).toBeVisible();
    await expect.poll(() => thumbnail.evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0);
    const photoBounds = await thumbnail.boundingBox(); const cardBounds = await cards.boundingBox();
    expect(Math.abs(photoBounds!.width / photoBounds!.height - 600 / 900)).toBeLessThan(0.02);
    expect(cardBounds!.width - photoBounds!.width).toBeLessThan(25);
    expect((await preview.boundingBox())!.width).toBeLessThan(420);
    await preview.screenshot({ path: "test-results/compact-single-photo.png" });
    await preview.getByRole("button", { name: "Preview photo portrait.webp", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Photo preview", exact: true }); await expect(dialog).toBeVisible(); await expect(dialog).toContainText("Not sent yet");
    expect((await dialog.getByRole("img").boundingBox())!.height).toBeGreaterThan(photoBounds!.height);
    await page.keyboard.press("Escape"); await expect(dialog).toHaveCount(0); await expect(caption).toHaveValue("Review these attachments together.");
    await page.setViewportSize({ width: 390, height: 640 });
    const pdf = Buffer.from("%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\n%%EOF");
    await input.setInputFiles([
      { name: "business-menu-with-a-long-file-name.pdf", mimeType: "application/pdf", buffer: pdf },
      { name: "extra-menu.pdf", mimeType: "application/pdf", buffer: pdf },
      { name: "landscape.png", mimeType: "image/png", buffer: landscape },
      { name: "voice.wav", mimeType: "audio/wav", buffer: silentWav() },
    ]);
    await expect(cards).toHaveCount(5); await expect(send).toBeEnabled(); await expect(caption).toBeFocused();
    const strip = preview.getByTestId("attachment-strip");
    expect(await strip.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true);
    const tops = await cards.evaluateAll((elements) => elements.map((element) => element.getBoundingClientRect().top));
    expect(Math.max(...tops) - Math.min(...tops)).toBeLessThan(1);
    expect((await preview.boundingBox())!.height).toBeLessThanOrEqual(640 * 0.45 + 1);
    await expect(send).toBeInViewport(); await expect(caption).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await preview.getByRole("button", { name: "Next attachments", exact: true }).click(); await expect.poll(() => strip.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
    await expect(preview.getByRole("button", { name: "Previous attachments", exact: true })).toBeEnabled();
    await preview.getByRole("button", { name: "Previous attachments", exact: true }).click(); await expect.poll(() => strip.evaluate((element) => element.scrollLeft)).toBe(0);
    await page.screenshot({ path: "test-results/compact-attachments-mobile.png" });
    expect((await f.db.from("chat_attachments").select("id").eq("conversation_id", f.group)).data).toHaveLength(0);
    await preview.getByRole("button", { name: "Remove attachment extra-menu.pdf", exact: true }).click(); await expect(cards).toHaveCount(4); await expect(caption).toHaveValue("Review these attachments together.");
    await send.click(); await expect(preview).toHaveCount(0);
    const bubble = page.getByRole("list", { name: "Messages", exact: true }).locator("[data-message-bubble]").filter({ hasText: "Review these attachments together." });
    await expect(bubble.getByTestId("attachment-caption")).toHaveText("Review these attachments together."); await expect(bubble.getByRole("img")).toHaveCount(2); await expect(bubble.getByTestId("voice-message")).toBeVisible();
    const { data: posted } = await f.db.from("messages").select("id").eq("conversation_id", f.group).eq("content", "Review these attachments together.").single();
    expect((await f.db.from("chat_attachments").select("id").eq("message_id", posted!.id)).data).toHaveLength(4);
  } finally {
    await context.close();
    const { data: objects } = await f.db.from("chat_attachments").select("path").eq("uploader_id", f.luca.userId); const paths = (objects ?? []).map((object) => object.path);
    const removed = paths.length ? await f.db.storage.from("chat-attachments").remove(paths) : { error: null }; await f.cleanup(); if (!removed.error && paths.length) await f.db.from("chat_attachment_gc").delete().in("path", paths);
  }
});
