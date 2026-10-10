import { expect, test, type Page } from "@playwright/test";
import { expectReport, runJourney } from "./journey";

const next = (page: Page) => page.getByRole("button", { name: /^Next:/ }).click();
const card = (page: Page, id: string) => page.locator(`article[data-question="${id}"]`);

test("AWS journey produces a complete branded PDF with AWS benchmark mappings", async ({ page }) => {
  const pages = await runJourney(page, "Amazon Web Services", { dsl: "DSL-3" });
  expectReport(pages);
  const all = pages.join("\n");
  for (const text of ["Amazon Web Services", "CIS AWS v7", "AWS FSBP"]) expect(all, text).toContain(text);
});

test("AWS AI asset surfaces Bedrock questions only when selected, and bedrock-agent is agentic", async ({ page }) => {
  await page.goto("./");
  await page.getByRole("button", { name: "Full crown-jewel assessment" }).click();
  await page.getByLabel("Organisation name").fill("Riverbend Health");
  await next(page);
  await page.getByRole("checkbox", { name: /Amazon Web Services/ }).check();
  await next(page);

  // Without the AI asset, the Bedrock/AgentCore domain stays out of scope.
  await page.getByRole("button", { name: /^Add crown jewel: AWS data stores/ }).click();
  await page.getByRole("button", { name: "Save crown jewel" }).click();
  await next(page);
  const sections = page.getByRole("navigation", { name: "Control sections" });
  await expect(sections.getByRole("button", { name: /Bedrock, AgentCore/ })).toHaveCount(0);
  await sections.getByRole("button", { name: /Network & workloads/ }).click();
  await expect(card(page, "AWS-NET-008")).toHaveCount(1);
  await expect(card(page, "AWS-AI-001")).toHaveCount(0);

  // Add the AI asset: the new questions appear under their domain.
  await page.getByRole("button", { name: /Crown jewels/ }).click();
  await page.getByRole("button", { name: /^Add crown jewel: Amazon Bedrock/ }).click();
  await page.getByRole("button", { name: "Save crown jewel" }).click();
  await next(page);
  await sections.getByRole("button", { name: /Bedrock, AgentCore/ }).click();
  for (const id of ["AWS-AI-001", "AWS-AI-002", "AWS-AI-003", "AWS-AI-004", "AWS-AI-005", "AWS-AI-006", "AWS-AI-007"]) {
    await expect(card(page, id)).toHaveCount(1);
  }
  await expect(card(page, "AWS-AI-004")).toContainText("defence in depth");

  // Skip SOC, open the AI register, and add a Bedrock agent with agentic oversight already on.
  await next(page);
  await next(page);
  await expect(page.getByRole("heading", { name: "Which AI tools and agents do you use?" })).toBeVisible();
  await page.getByRole("button", { name: "Start an AI use-case register" }).click();
  await page.getByRole("button", { name: "Add AI use case: Amazon Bedrock or AgentCore agent" }).click();
  const entry = page.locator("[data-ai-entry]");
  await expect(entry.getByRole("radiogroup", { name: "Oversight model" }).getByRole("radio", { name: /^Acts under supervision/ })).toHaveAttribute(
    "aria-checked",
    "true",
  );
  await expect(entry.locator('[data-ai-question="AIR-OFF-001"]')).toHaveCount(1);
  await expect(entry.getByText("AWS-AI-001")).toBeVisible();
});
