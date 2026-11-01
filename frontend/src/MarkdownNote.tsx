import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { BrowserOpenURL } from "../wailsjs/runtime/runtime";
export function MarkdownNote({ text }: { text: string }) {
  return (
    <article className="markdown-body" aria-label="Просмотр заметки">
      <Markdown
        remarkPlugins={[remarkGfm]}
        skipHtml
        components={{
          a: ({ href, children }) => (
            <a
              href={href}
              onClick={(e) => {
                e.preventDefault();
                if (href && /^(https?:|mailto:)/i.test(href)) BrowserOpenURL(href);
              }}
            >
              {children}
            </a>
          ),
          img: ({ alt }) => <span className="muted">[Изображение: {alt || "без подписи"}]</span>,
        }}
      >
        {text || "Здесь появится отформатированная заметка."}
      </Markdown>
    </article>
  );
}
