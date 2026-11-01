import { describe, it, expect } from "vite-plus/test";
import { formatMarkdown } from "./markdownFormat";

describe("Markdown save formatting", () => {
  it("normalizes headings and lists", async () => {
    expect(await formatMarkdown("#   План\n\n*   первый\n* второй")).toBe(
      "# План\n\n- первый\n- второй\n",
    );
  });
  it("preserves manual line breaks and fenced code contents", async () => {
    const source =
      "Первая строка\nВторая строка\n\n```js\nconst x   =  1;\n  console.log( x )\n```\n";
    expect(await formatMarkdown(source)).toBe(source);
  });
  it("keeps empty notes empty and formatting idempotent", async () => {
    expect(await formatMarkdown("")).toBe("");
    const once = await formatMarkdown("*   **пункт**\n\n[ссылка](https://example.com)\n");
    expect(await formatMarkdown(once)).toBe(once);
  });
});
