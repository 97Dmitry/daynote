// Only Markdown is loaded. Notes never leave the renderer for formatting.
let formatter:
  | Promise<[typeof import("prettier/standalone"), typeof import("prettier/plugins/markdown")]>
  | undefined;
export async function formatMarkdown(text: string): Promise<string> {
  if (!text.trim()) return "";
  formatter ??= Promise.all([import("prettier/standalone"), import("prettier/plugins/markdown")]);
  const [prettier, markdown] = await formatter;
  return prettier.format(text, {
    parser: "markdown",
    plugins: [markdown],
    proseWrap: "preserve",
    embeddedLanguageFormatting: "off",
    endOfLine: "lf",
    tabWidth: 2,
  });
}
